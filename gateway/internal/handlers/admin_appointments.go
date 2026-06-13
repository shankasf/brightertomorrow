package handlers

import (
	"context"
	"encoding/csv"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/calendar"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminAppointmentsHandler serves /admin/api/appointments and the CSV export.
//
// Reads from DynamoDB bt-main directly — the legacy bt.intake_pointers
// Postgres table is no longer populated (Hostinger VPS is not BAA-covered).
// Pool stays on the handler only for any non-PHI legacy queries; PHI list
// + audit writes both target DDB via phi.Store.
type AdminAppointmentsHandler struct {
	Pool          *pgxpool.Pool
	PHI           *phi.Store
	Notify        *phi.NotificationStore // optional; nil → notifications silently skipped
	NotifyEnabled bool                   // gates the enqueue block; default false (see BT_APPOINTMENT_NOTIFY_ENABLED)
}

// appointmentRow is the merged DDB record shape returned to admins.
// ID is the submissionUUID — no Postgres serial id any more.
type appointmentRow struct {
	ID                string `json:"id"`
	SubmissionUUID    string `json:"submission_uuid"`
	EmailHash         string `json:"email_hash"`
	CreatedAt         string `json:"created_at"`
	AppointmentTime   string `json:"appointment_time,omitempty"`
	TherapistStaffID  int    `json:"therapist_staff_id,omitempty"`
	TherapistName     string `json:"therapist_name,omitempty"` // resolved calendar roster name, blank if unknown
	Source            string `json:"source"`
	SourceLabel       string `json:"source_label"`
	Flow              string `json:"flow"`
	Status            string `json:"status"`          // coverage/insurance status — do NOT repurpose
	WorkflowStatus    string `json:"workflow_status"` // admin workflow status (new/approved/cancelled/…)
	PaymentMethod     string `json:"payment_method"`
	FirstName         string `json:"first_name"`
	LastName          string `json:"last_name"`
	DateOfBirth       string `json:"date_of_birth"`
	Phone             string `json:"phone"`
	Email             string `json:"email"`
	HomeAddress       string `json:"home_address"`
	Sex               string `json:"sex"`
	InsuranceName     string `json:"insurance_name"`
	InsuranceMemberID string `json:"insurance_member_id"`
}

// workflowStatusFilter is the parsed ?workflow_status= query param.
type workflowStatusFilter struct {
	raw string // "", "all", or a valid enum value
}

type appointmentFilters struct {
	From           *time.Time
	To             *time.Time
	Source         string // friendly: chatbot | voice | phone | website
	Q              string
	WorkflowStatus workflowStatusFilter
	Limit          int
	Offset         int
}

func parseAppointmentFilters(r *http.Request, defaultLimit, maxLimit int) (appointmentFilters, error) {
	q := r.URL.Query()
	f := appointmentFilters{Source: strings.ToLower(strings.TrimSpace(q.Get("source")))}

	if s := q.Get("from"); s != "" {
		t, err := time.Parse("2006-01-02", s)
		if err != nil {
			return f, fmt.Errorf("invalid 'from' date — expected YYYY-MM-DD")
		}
		f.From = &t
	}
	if s := q.Get("to"); s != "" {
		t, err := time.Parse("2006-01-02", s)
		if err != nil {
			return f, fmt.Errorf("invalid 'to' date — expected YYYY-MM-DD")
		}
		end := t.Add(24*time.Hour - time.Second)
		f.To = &end
	}
	switch f.Source {
	case "", "all", "chatbot", "voice", "phone", "website":
	default:
		return f, fmt.Errorf("invalid 'source' — expected chatbot, voice, phone, website, or all")
	}
	f.Q = strings.TrimSpace(q.Get("q"))

	// workflow_status filter:
	//   ""    → exclude archived (default working list)
	//   "all" → include everything
	//   valid enum value → exact match
	if ws := strings.TrimSpace(q.Get("workflow_status")); ws != "" {
		if ws != "all" && !phi.IsValidWorkflowStatus(ws) {
			return f, fmt.Errorf("invalid 'workflow_status' — must be a valid status value or 'all'")
		}
		f.WorkflowStatus = workflowStatusFilter{raw: ws}
	}

	limit, _ := strconv.Atoi(q.Get("limit"))
	page, _ := strconv.Atoi(q.Get("page"))
	if limit < 1 || limit > maxLimit {
		limit = defaultLimit
	}
	if page < 1 {
		page = 1
	}
	f.Limit = limit
	f.Offset = (page - 1) * limit
	return f, nil
}

// sourcesForFriendly maps the UI's friendly source filter to the raw
// source strings stored on the DDB IntakeRecord.
//
//	chatbot → chat-agent
//	voice   → voice-agent + voice-phone
//	phone   → voice-phone
//	website → website-booking-flow + website-coverage-flow + website-match-flow
//
// Empty / "all" returns nil (no filter).
func sourcesForFriendly(f string) []string {
	switch f {
	case "chatbot":
		return []string{"chat-agent"}
	case "voice":
		return []string{"voice-agent", "voice-phone"}
	case "phone":
		return []string{"voice-phone"}
	case "website":
		return []string{"website-booking-flow", "website-coverage-flow", "website-match-flow"}
	}
	return nil
}

// sourceLabel renders one stored source value as the admin UI label.
func sourceLabel(s string) string {
	switch s {
	case "chat-agent":
		return "Chatbot"
	case "voice-agent":
		return "Voice (web)"
	case "voice-phone":
		return "Voice (phone)"
	case "website-booking-flow":
		return "Website (Booking)"
	case "website-coverage-flow":
		return "Website (Coverage)"
	case "website-match-flow":
		return "Website (Match)"
	default:
		return s
	}
}

// applyWorkflowFilter filters rows in-memory based on the workflow_status param:
//   - empty raw → exclude rows whose effective status is "archived"
//   - "all"     → include everything
//   - specific  → only rows whose effective status equals that value
func applyWorkflowFilter(rows []appointmentRow, wf workflowStatusFilter) []appointmentRow {
	if wf.raw == "all" {
		return rows
	}
	out := rows[:0]
	for _, row := range rows {
		effective := row.WorkflowStatus
		if effective == "" {
			effective = "new"
		}
		if wf.raw == "" {
			// Default: exclude archived.
			if effective == "archived" {
				continue
			}
			out = append(out, row)
			continue
		}
		// Specific value: exact match.
		if effective == wf.raw {
			out = append(out, row)
		}
	}
	return out
}

// fetchAppointments queries DDB for intake records and applies the
// requested filters in-memory. Returns the full filtered set (caller
// paginates the slice).
func (h *AdminAppointmentsHandler) fetchAppointments(r *http.Request, f appointmentFilters) ([]appointmentRow, error) {
	want := sourcesForFriendly(f.Source)

	pf := phi.IntakeFilter{
		From:       f.From,
		To:         f.To,
		SearchText: f.Q,
		Limit:      10000,
	}
	if len(want) == 1 {
		pf.Source = want[0]
	}

	recs, _, err := h.PHI.ListIntakePointers(r.Context(), pf)
	if err != nil {
		return nil, err
	}

	rows := make([]appointmentRow, 0, len(recs))
	for _, rec := range recs {
		if len(want) > 1 {
			matched := false
			for _, w := range want {
				if rec.Source == w {
					matched = true
					break
				}
			}
			if !matched {
				continue
			}
		}

		wfStatus := rec.WorkflowStatus
		if wfStatus == "" {
			wfStatus = "new"
		}

		row := appointmentRow{
			ID:                rec.SubmissionUUID,
			SubmissionUUID:    rec.SubmissionUUID,
			EmailHash:         rec.EmailHash,
			CreatedAt:         rec.CreatedAt.UTC().Format(time.RFC3339),
			Source:            rec.Source,
			SourceLabel:       sourceLabel(rec.Source),
			Flow:              rec.Flow,
			Status:            rec.CoverageStatus,
			WorkflowStatus:    wfStatus,
			PaymentMethod:     rec.PaymentMethod,
			FirstName:         rec.FirstName,
			LastName:          rec.LastName,
			DateOfBirth:       rec.DateOfBirth,
			Phone:             rec.Phone,
			Email:             rec.Email,
			HomeAddress:       rec.HomeAddress,
			Sex:               rec.Sex,
			InsuranceName:     rec.InsuranceName,
			InsuranceMemberID: rec.InsuranceMemberID,
		}
		if rec.AppointmentTime != nil {
			row.AppointmentTime = rec.AppointmentTime.UTC().Format(time.RFC3339)
		}
		if rec.TherapistStaffID != nil {
			row.TherapistStaffID = *rec.TherapistStaffID
			if t, ok := calendar.ByID(*rec.TherapistStaffID); ok {
				row.TherapistName = t.Name
			}
		}
		rows = append(rows, row)
	}

	// Apply workflow status filter in-memory.
	rows = applyWorkflowFilter(rows, f.WorkflowStatus)

	return rows, nil
}

// auditBulk writes one §164.312(b) row per row returned, fire-and-forget.
func (h *AdminAppointmentsHandler) auditBulk(r *http.Request, action string, rows []appointmentRow) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok || len(rows) == 0 {
		return
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.SubmissionUUID)
	}
	admin.LogPHIAccessBatch(r.Context(), h.PHI, r, u, action, "intake_pointers_phi_access", ids)
}

// List handles GET /admin/api/appointments.
func (h *AdminAppointmentsHandler) List(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}
	f, err := parseAppointmentFilters(r, 25, 200)
	if err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}

	all, err := h.fetchAppointments(r, f)
	if err != nil {
		slog.Error("appointments list: ddb query", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	total := len(all)
	start := f.Offset
	end := f.Offset + f.Limit
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}
	rows := all[start:end]

	h.auditBulk(r, "view_appointments_list", rows)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"items": rows,
		"total": total,
		"page":  (f.Offset / f.Limit) + 1,
		"limit": f.Limit,
	})
}

// ExportCSV handles GET /admin/api/appointments.csv.
func (h *AdminAppointmentsHandler) ExportCSV(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}
	f, err := parseAppointmentFilters(r, 5000, 5000)
	if err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}
	f.Limit = 5000
	f.Offset = 0

	rows, err := h.fetchAppointments(r, f)
	if err != nil {
		slog.Error("appointments csv: ddb query", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	h.auditBulk(r, "export_appointments_csv", rows)

	filename := fmt.Sprintf("appointments-%s.csv", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	cw := csv.NewWriter(w)
	_ = cw.Write([]string{
		"Submission UUID", "Created At", "Appointment Time", "Therapist Staff ID",
		"Source", "Flow", "Status", "Payment Method",
		"First Name", "Last Name", "Date of Birth", "Phone", "Email", "Home Address", "Sex",
		"Insurance Name", "Insurance ID Number",
		// New columns appended — existing consumers unaffected.
		"Email Hash", "Workflow Status", "Interested Therapist",
	})
	for _, r := range rows {
		staffID := ""
		if r.TherapistStaffID != 0 {
			staffID = strconv.Itoa(r.TherapistStaffID)
		}
		wfStatus := r.WorkflowStatus
		if wfStatus == "" {
			wfStatus = "new"
		}
		_ = cw.Write([]string{
			r.SubmissionUUID, r.CreatedAt, r.AppointmentTime, staffID,
			r.SourceLabel, r.Flow, r.Status, r.PaymentMethod,
			r.FirstName, r.LastName, r.DateOfBirth, r.Phone, r.Email, r.HomeAddress, r.Sex,
			r.InsuranceName, r.InsuranceMemberID,
			r.EmailHash, wfStatus, r.TherapistName,
		})
	}
	cw.Flush()
}

// ---------------------------------------------------------------------------
// UpdateStatus — POST /admin/api/appointments/status
// ---------------------------------------------------------------------------

// updateStatusRequest is the JSON body for the bulk workflow-status update.
type updateStatusRequest struct {
	Status string             `json:"status"`
	Notify bool               `json:"notify"`
	Items  []statusUpdateItem `json:"items"`
}

type statusUpdateItem struct {
	SubmissionUUID string `json:"submission_uuid"`
	EmailHash      string `json:"email_hash"`
}

// statusUpdateFailure captures per-item errors for the response.
type statusUpdateFailure struct {
	SubmissionUUID string `json:"submission_uuid"`
	Error          string `json:"error"`
}

// notifyStatuses is the set of workflow statuses that trigger patient notifications.
var notifyStatuses = map[string]struct{}{
	"approved":             {},
	"scheduled":            {},
	"cancelled":            {},
	"reschedule_requested": {},
	"cancel_requested":     {},
	"completed":            {},
}

// UpdateStatus handles POST /admin/api/appointments/status.
// Updates the workflow status for one or more appointment records, optionally
// enqueuing patient notifications via the outbox.
func (h *AdminAppointmentsHandler) UpdateStatus(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}

	var body updateStatusRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON body")
		return
	}

	if !phi.IsValidWorkflowStatus(body.Status) {
		httpx.WriteValidationError(w, fmt.Sprintf("invalid status %q", body.Status))
		return
	}
	if len(body.Items) == 0 || len(body.Items) > 100 {
		httpx.WriteValidationError(w, "items must contain between 1 and 100 entries")
		return
	}
	for i, item := range body.Items {
		if item.SubmissionUUID == "" || item.EmailHash == "" {
			httpx.WriteValidationError(w, fmt.Sprintf("items[%d]: submission_uuid and email_hash are required", i))
			return
		}
	}

	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "admin identity not found")
		return
	}
	adminBy := u.Email
	if adminBy == "" {
		adminBy = strconv.FormatInt(u.ID, 10)
	}

	ctx := r.Context()
	_, doNotify := notifyStatuses[body.Status]
	doNotify = doNotify && body.Notify

	var (
		successIDs []string
		failures   []statusUpdateFailure
		notified   int
	)

	for _, item := range body.Items {
		err := h.PHI.UpdateIntakeWorkflowStatus(ctx, item.EmailHash, item.SubmissionUUID, body.Status, adminBy)
		if err != nil {
			failures = append(failures, statusUpdateFailure{
				SubmissionUUID: item.SubmissionUUID,
				Error:          friendlyUpdateError(err),
			})
			continue
		}
		successIDs = append(successIDs, item.SubmissionUUID)

		// Best-effort notification enqueue for approved/cancelled.
		// Gated by NotifyEnabled: the gateway IAM kms:Encrypt grant is
		// conditioned on kms:ViaService=dynamodb/sns until infra is
		// provisioned; skip the block entirely so prod logs stay clean.
		if doNotify && h.NotifyEnabled && h.Notify != nil {
			rec, getErr := h.PHI.GetIntake(ctx, item.EmailHash, item.SubmissionUUID)
			if getErr != nil {
				slog.Warn("appointments update_status: get intake for notify failed",
					"submission_uuid", item.SubmissionUUID, "err", getErr)
			} else {
				// Audit the PHI read for notification purposes.
				admin.LogPHIAccess(ctx, h.PHI, r, u,
					"update_appointment_status_notify_read",
					"intake_pointers_phi_access", item.SubmissionUUID)

				n := enqueuePatientNotifications(ctx, h.Notify, rec, body.Status, item.SubmissionUUID)
				notified += n
			}
		}
	}

	// Audit successful updates (one row per submission_uuid).
	if len(successIDs) > 0 {
		admin.LogPHIAccessBatch(ctx, h.PHI, r, u,
			"update_appointment_status:"+body.Status,
			"intake_pointers_phi_access",
			successIDs)
	}

	// Always emit an array (not null) so clients can safely read `.length`.
	if failures == nil {
		failures = []statusUpdateFailure{}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"updated":  len(successIDs),
		"failed":   failures,
		"notified": notified,
	})
}

// friendlyUpdateError converts phi-level errors to client-safe strings.
// Never leaks internal error text with PHI.
func friendlyUpdateError(err error) string {
	if err == phi.ErrNotFound {
		return "record not found"
	}
	return "update failed"
}

// enqueuePatientNotifications enqueues email notifications for the given intake
// record and workflow status. Returns the number of notifications enqueued.
// All errors are logged and swallowed — callers must never fail over this.
//
// SMS is intentionally skipped for now (Twilio outbound not yet provisioned).
func enqueuePatientNotifications(
	ctx context.Context,
	store *phi.NotificationStore,
	rec *phi.IntakeRecord,
	status, submissionUUID string,
) int {
	greeting := notifyGreeting(strings.TrimSpace(rec.FirstName))

	var emailSubject, emailHeading string
	var emailParagraphs []string
	var emailDetails [][2]string

	switch status {
	case "approved":
		emailSubject, emailHeading, emailParagraphs, emailDetails = buildApprovedContent(greeting)
	case "cancelled":
		emailSubject, emailHeading, emailParagraphs, emailDetails = buildCancelledContent(greeting)
	case "scheduled":
		var apptFormatted string
		if rec.AppointmentTime != nil {
			apptFormatted = formatApptTime(rec.AppointmentTime.UTC().Format(time.RFC3339))
		}
		var staffID int
		if rec.TherapistStaffID != nil {
			staffID = *rec.TherapistStaffID
		}
		therapistName := therapistDisplayName(staffID)
		emailSubject, emailHeading, emailParagraphs, emailDetails = buildScheduledContent(greeting, therapistName, apptFormatted)
	case "reschedule_requested":
		emailSubject, emailHeading, emailParagraphs, emailDetails = buildRescheduleRequestedContent(greeting)
	case "cancel_requested":
		emailSubject, emailHeading, emailParagraphs, emailDetails = buildCancelRequestedContent(greeting)
	case "completed":
		emailSubject, emailHeading, emailParagraphs, emailDetails = buildCompletedContent(greeting)
	default:
		return 0
	}

	count := 0

	// Cancel/reschedule emails carry the cancellation policy (48-hour fee +
	// My Account link); booking confirmations and completions do not.
	cancelNotice := status == "cancelled" || status == "cancel_requested" || status == "reschedule_requested"

	// Email — structured content payload; the Lambda renders the branded HTML.
	if email := strings.TrimSpace(rec.Email); email != "" {
		dedupeKey := fmt.Sprintf("apptstatus:%s:%s:email", submissionUUID, status)
		if enqueueEmail(ctx, store, email, emailSubject, emailHeading, emailParagraphs, emailDetails, cancelNotice, dedupeKey, submissionUUID) {
			count++
		}
	}

	return count
}
