package handlers

import (
	"encoding/csv"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
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
	Pool *pgxpool.Pool
	PHI  *phi.Store
}

// appointmentRow is the merged DDB record shape returned to admins.
// ID is the submissionUUID — no Postgres serial id any more.
type appointmentRow struct {
	ID                string `json:"id"`
	SubmissionUUID    string `json:"submission_uuid"`
	CreatedAt         string `json:"created_at"`
	AppointmentTime   string `json:"appointment_time,omitempty"`
	TherapistStaffID  int    `json:"therapist_staff_id,omitempty"`
	Source            string `json:"source"`
	SourceLabel       string `json:"source_label"`
	Flow              string `json:"flow"`
	Status            string `json:"status"`
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

type appointmentFilters struct {
	From   *time.Time
	To     *time.Time
	Source string // friendly: chatbot | voice | phone | website
	Q      string
	Limit  int
	Offset int
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

		row := appointmentRow{
			ID:                rec.SubmissionUUID,
			SubmissionUUID:    rec.SubmissionUUID,
			CreatedAt:         rec.CreatedAt.UTC().Format(time.RFC3339),
			Source:            rec.Source,
			SourceLabel:       sourceLabel(rec.Source),
			Flow:              rec.Flow,
			Status:            rec.CoverageStatus,
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
		}
		rows = append(rows, row)
	}
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
	})
	for _, r := range rows {
		staffID := ""
		if r.TherapistStaffID != 0 {
			staffID = strconv.Itoa(r.TherapistStaffID)
		}
		_ = cw.Write([]string{
			r.SubmissionUUID, r.CreatedAt, r.AppointmentTime, staffID,
			r.SourceLabel, r.Flow, r.Status, r.PaymentMethod,
			r.FirstName, r.LastName, r.DateOfBirth, r.Phone, r.Email, r.HomeAddress, r.Sex,
			r.InsuranceName, r.InsuranceMemberID,
		})
	}
	cw.Flush()
}
