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
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminAppointmentsHandler serves /admin/api/appointments and the CSV export.
// Each request audits the PHI read so the admin_access_log shows exactly which
// submissions a given admin viewed and when. §164.312(b)
type AdminAppointmentsHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store
}

// appointmentRow is the merged pointer + DDB PHI shape returned to admins.
type appointmentRow struct {
	ID                int64  `json:"id"`
	SubmissionUUID    string `json:"submission_uuid"`
	CreatedAt         string `json:"created_at"`
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

// pointerMeta is everything we read from Postgres for the list view.
type pointerMeta struct {
	ID             int64
	SubmissionUUID string
	EmailHash      string
	Flow           string
	PaymentMethod  string
	Status         string
	Source         string
	CreatedAt      time.Time
}

// query parses, validates, and applies the filter set used by both the JSON
// list and the CSV export endpoints.
type appointmentFilters struct {
	From   *time.Time
	To     *time.Time
	Source string // "chatbot", "website", or "" for all
	Q      string // free-text match on first/last/email after PHI hydration
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
		// Make `to` inclusive of the whole day.
		end := t.Add(24*time.Hour - time.Second)
		f.To = &end
	}
	switch f.Source {
	case "", "all", "chatbot", "voice", "website":
	default:
		return f, fmt.Errorf("invalid 'source' — expected chatbot, voice, website, or all")
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

// sourceClause returns SQL fragment + arg for the source filter. Chatbot is
// `source = 'chat-agent'`; Voice is `source = 'voice-agent'`; Website matches
// the two website-* values from intake.go; "all" / "" returns no clause.
func sourceClause(src string, argIdx *int) (string, []any) {
	switch src {
	case "chatbot":
		s := fmt.Sprintf("AND source = $%d", *argIdx)
		*argIdx++
		return s, []any{"chat-agent"}
	case "voice":
		s := fmt.Sprintf("AND source = $%d", *argIdx)
		*argIdx++
		return s, []any{"voice-agent"}
	case "website":
		s := fmt.Sprintf("AND source = ANY($%d)", *argIdx)
		*argIdx++
		return s, []any{[]string{"website-booking-flow", "website-coverage-flow"}}
	}
	return "", nil
}

// loadPointers fetches the metadata rows for the given filters. PHI is NOT
// touched here — only the Postgres pointer table.
func (h *AdminAppointmentsHandler) loadPointers(ctx context.Context, f appointmentFilters, limit int) ([]pointerMeta, int, error) {
	args := []any{}
	argIdx := 1
	where := []string{"purged_at IS NULL"}

	if f.From != nil {
		where = append(where, fmt.Sprintf("created_at >= $%d", argIdx))
		args = append(args, *f.From)
		argIdx++
	}
	if f.To != nil {
		where = append(where, fmt.Sprintf("created_at <= $%d", argIdx))
		args = append(args, *f.To)
		argIdx++
	}
	src, srcArgs := sourceClause(f.Source, &argIdx)
	if src != "" {
		// Drop the leading "AND " — already inside WHERE.
		where = append(where, strings.TrimPrefix(src, "AND "))
		args = append(args, srcArgs...)
	}

	whereSQL := "WHERE " + strings.Join(where, " AND ")

	var total int
	if err := h.Pool.QueryRow(ctx,
		`SELECT count(*) FROM bt.intake_pointers `+whereSQL, args...,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, limit, f.Offset)
	listSQL := `SELECT id, submission_uuid, email_hash, flow, payment_method, status, source, created_at
	            FROM bt.intake_pointers ` + whereSQL +
		fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)

	rows, err := h.Pool.Query(ctx, listSQL, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]pointerMeta, 0, limit)
	for rows.Next() {
		var p pointerMeta
		if err := rows.Scan(&p.ID, &p.SubmissionUUID, &p.EmailHash,
			&p.Flow, &p.PaymentMethod, &p.Status, &p.Source, &p.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, p)
	}
	return out, total, rows.Err()
}

// hydrate fetches the PHI record for each pointer from DynamoDB and returns
// the merged rows. Pointers whose DDB record is missing are skipped (logged).
func (h *AdminAppointmentsHandler) hydrate(ctx context.Context, ptrs []pointerMeta) []appointmentRow {
	out := make([]appointmentRow, 0, len(ptrs))
	for _, p := range ptrs {
		rec, err := h.PHI.GetIntake(ctx, p.EmailHash, p.SubmissionUUID)
		if err != nil || rec == nil {
			slog.Warn("appointments: ddb get missed",
				"submission_uuid", p.SubmissionUUID, "err", err)
			continue
		}
		out = append(out, appointmentRow{
			ID:                p.ID,
			SubmissionUUID:    p.SubmissionUUID,
			CreatedAt:         p.CreatedAt.UTC().Format(time.RFC3339),
			Source:            p.Source,
			SourceLabel:       sourceLabel(p.Source),
			Flow:              p.Flow,
			Status:            p.Status,
			PaymentMethod:     p.PaymentMethod,
			FirstName:         rec.FirstName,
			LastName:          rec.LastName,
			DateOfBirth:       rec.DateOfBirth,
			Phone:             rec.Phone,
			Email:             rec.Email,
			HomeAddress:       rec.HomeAddress,
			Sex:               rec.Sex,
			InsuranceName:     rec.InsuranceName,
			InsuranceMemberID: rec.InsuranceMemberID,
		})
	}
	return out
}

// applyTextFilter narrows hydrated rows by case-insensitive substring match
// on first name, last name, or email — the only PHI fields admins typically
// search on. Done after hydration because names live in DynamoDB.
func applyTextFilter(rows []appointmentRow, q string) []appointmentRow {
	if q == "" {
		return rows
	}
	q = strings.ToLower(q)
	out := rows[:0]
	for _, r := range rows {
		if strings.Contains(strings.ToLower(r.FirstName), q) ||
			strings.Contains(strings.ToLower(r.LastName), q) ||
			strings.Contains(strings.ToLower(r.Email), q) ||
			strings.Contains(strings.ToLower(r.Phone), q) {
			out = append(out, r)
		}
	}
	return out
}

func sourceLabel(s string) string {
	switch s {
	case "chat-agent":
		return "Chatbot"
	case "voice-agent":
		return "Voice"
	case "website-booking-flow":
		return "Website (Booking)"
	case "website-coverage-flow":
		return "Website (Coverage)"
	default:
		return s
	}
}

// auditBulk records one access_log row per submission viewed.
// HIPAA §164.312(b) — append-only, no batching shortcuts.
func (h *AdminAppointmentsHandler) auditBulk(ctx context.Context, r *http.Request, action string, rows []appointmentRow) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		return
	}
	for _, row := range rows {
		admin.LogPHIAccess(ctx, h.Pool, r, u, action, "intake_pointers_phi_access", row.SubmissionUUID)
	}
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

	// Over-fetch so q-filter (post-hydrate) still produces a full page when
	// the search trims results. Capped to keep PHI fanout bounded.
	fetch := f.Limit
	if f.Q != "" {
		fetch = f.Limit * 4
		if fetch > 200 {
			fetch = 200
		}
	}

	ptrs, total, err := h.loadPointers(r.Context(), f, fetch)
	if err != nil {
		slog.Error("appointments list: pointers", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	rows := h.hydrate(r.Context(), ptrs)
	rows = applyTextFilter(rows, f.Q)

	// If we over-fetched for q-filtering, trim to requested page size.
	if len(rows) > f.Limit {
		rows = rows[:f.Limit]
	}

	h.auditBulk(r.Context(), r, "view_appointments_list", rows)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"items": rows,
		"total": total, // total matching pointers (pre-q-filter)
		"page":  (f.Offset / f.Limit) + 1,
		"limit": f.Limit,
	})
}

// ExportCSV handles GET /admin/api/appointments.csv.
// Streams CSV with the same filters as List. Capped at 5000 rows per export.
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
	// Force full export — ignore page param.
	f.Limit = 5000
	f.Offset = 0

	ptrs, _, err := h.loadPointers(r.Context(), f, 5000)
	if err != nil {
		slog.Error("appointments csv: pointers", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	rows := h.hydrate(r.Context(), ptrs)
	rows = applyTextFilter(rows, f.Q)

	h.auditBulk(r.Context(), r, "export_appointments_csv", rows)

	filename := fmt.Sprintf("appointments-%s.csv", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	// Don't cache PHI on intermediaries.
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	cw := csv.NewWriter(w)
	_ = cw.Write([]string{
		"Submission UUID", "Created At", "Source", "Flow", "Status", "Payment Method",
		"First Name", "Last Name", "Date of Birth", "Phone", "Email", "Home Address", "Sex",
		"Insurance Name", "Insurance ID Number",
	})
	for _, r := range rows {
		_ = cw.Write([]string{
			r.SubmissionUUID, r.CreatedAt, r.SourceLabel, r.Flow, r.Status, r.PaymentMethod,
			r.FirstName, r.LastName, r.DateOfBirth, r.Phone, r.Email, r.HomeAddress, r.Sex,
			r.InsuranceName, r.InsuranceMemberID,
		})
	}
	cw.Flush()
}
