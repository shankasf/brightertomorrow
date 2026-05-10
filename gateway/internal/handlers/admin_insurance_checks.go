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

// AdminInsuranceChecksHandler exposes the eligibility-check history.
// Each check is recorded in bt.insurance_checks (non-PHI metadata only); the
// patient PHI lives in DynamoDB and is hydrated on demand via submission_uuid.
//
// HIPAA: every list / export / detail call writes one access_log row per
// PHI record returned, so "who looked up which check, when" is auditable.
type AdminInsuranceChecksHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store
}

// insuranceCheckRow is the merged shape returned to admins.
type insuranceCheckRow struct {
	ID              int64  `json:"id"`
	CheckUUID       string `json:"check_uuid"`
	SubmissionUUID  string `json:"submission_uuid,omitempty"`
	CreatedAt       string `json:"created_at"`
	Source          string `json:"source"`
	SourceLabel     string `json:"source_label"`
	PayerName       string `json:"payer_name"`
	CoverageStatus  string `json:"coverage_status"`
	Eligible        bool   `json:"eligible"`
	// PHI hydrated from DDB (omitted when no submission_uuid is linked).
	FirstName       string `json:"first_name,omitempty"`
	LastName        string `json:"last_name,omitempty"`
	DateOfBirth     string `json:"date_of_birth,omitempty"`
	Phone           string `json:"phone,omitempty"`
	Email           string `json:"email,omitempty"`
	MemberID        string `json:"insurance_member_id,omitempty"`
}

type insuranceCheckMeta struct {
	ID              int64
	CheckUUID       string
	SubmissionUUID  *string
	EmailHash       string
	Source          string
	PayerName       string
	CoverageStatus  string
	Eligible        bool
	CreatedAt       time.Time
}

type insuranceCheckFilters struct {
	From      *time.Time
	To        *time.Time
	Source    string // "chatbot", "voice", "website", or "" for all
	Status    string // "eligible" | "ineligible" | "needs_review" | "verification_error" | ""
	Q         string
	Limit     int
	Offset    int
}

func parseInsuranceCheckFilters(r *http.Request, defaultLimit, maxLimit int) (insuranceCheckFilters, error) {
	q := r.URL.Query()
	f := insuranceCheckFilters{
		Source: strings.ToLower(strings.TrimSpace(q.Get("source"))),
		Status: strings.ToLower(strings.TrimSpace(q.Get("status"))),
	}

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
	case "", "all", "chatbot", "voice", "website":
	default:
		return f, fmt.Errorf("invalid 'source' — expected chatbot, voice, website, or all")
	}
	switch f.Status {
	case "", "all", "eligible", "ineligible", "needs_review", "verification_error":
	default:
		return f, fmt.Errorf("invalid 'status'")
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

// insuranceSourceClause maps the public source filter to one or more source
// values stored in bt.insurance_checks.
func insuranceSourceClause(src string, argIdx *int) (string, []any) {
	switch src {
	case "chatbot":
		s := fmt.Sprintf("source = $%d", *argIdx)
		*argIdx++
		return s, []any{"chat-agent"}
	case "voice":
		s := fmt.Sprintf("source = $%d", *argIdx)
		*argIdx++
		return s, []any{"voice-agent"}
	case "website":
		s := fmt.Sprintf("source = ANY($%d)", *argIdx)
		*argIdx++
		return s, []any{[]string{"website-booking-flow", "website-coverage-flow"}}
	}
	return "", nil
}

func (h *AdminInsuranceChecksHandler) loadChecks(ctx context.Context, f insuranceCheckFilters, limit int) ([]insuranceCheckMeta, int, error) {
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
	if src, srcArgs := insuranceSourceClause(f.Source, &argIdx); src != "" {
		where = append(where, src)
		args = append(args, srcArgs...)
	}
	if f.Status != "" && f.Status != "all" {
		where = append(where, fmt.Sprintf("coverage_status = $%d", argIdx))
		args = append(args, f.Status)
		argIdx++
	}

	whereSQL := "WHERE " + strings.Join(where, " AND ")

	var total int
	if err := h.Pool.QueryRow(ctx,
		`SELECT count(*) FROM bt.insurance_checks `+whereSQL, args...,
	).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, limit, f.Offset)
	listSQL := `SELECT id, check_uuid, submission_uuid, email_hash, source,
	                   COALESCE(payer_name, ''), coverage_status, eligible, created_at
	            FROM bt.insurance_checks ` + whereSQL +
		fmt.Sprintf(" ORDER BY created_at DESC LIMIT $%d OFFSET $%d", argIdx, argIdx+1)

	rows, err := h.Pool.Query(ctx, listSQL, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	out := make([]insuranceCheckMeta, 0, limit)
	for rows.Next() {
		var c insuranceCheckMeta
		if err := rows.Scan(&c.ID, &c.CheckUUID, &c.SubmissionUUID, &c.EmailHash,
			&c.Source, &c.PayerName, &c.CoverageStatus, &c.Eligible, &c.CreatedAt); err != nil {
			return nil, 0, err
		}
		out = append(out, c)
	}
	return out, total, rows.Err()
}

// hydrateChecks fills name/phone/email/member_id from DynamoDB for each row
// that has a submission_uuid. Pure pointer rows (no submission) keep PHI
// fields empty — which is fine because none was ever written.
func (h *AdminInsuranceChecksHandler) hydrateChecks(ctx context.Context, ms []insuranceCheckMeta) []insuranceCheckRow {
	out := make([]insuranceCheckRow, 0, len(ms))
	for _, m := range ms {
		row := insuranceCheckRow{
			ID:             m.ID,
			CheckUUID:      m.CheckUUID,
			CreatedAt:      m.CreatedAt.UTC().Format(time.RFC3339),
			Source:         m.Source,
			SourceLabel:    sourceLabel(m.Source),
			PayerName:      m.PayerName,
			CoverageStatus: m.CoverageStatus,
			Eligible:       m.Eligible,
		}
		if m.SubmissionUUID != nil && *m.SubmissionUUID != "" {
			row.SubmissionUUID = *m.SubmissionUUID
			rec, err := h.PHI.GetIntake(ctx, m.EmailHash, *m.SubmissionUUID)
			if err == nil && rec != nil {
				row.FirstName = rec.FirstName
				row.LastName = rec.LastName
				row.DateOfBirth = rec.DateOfBirth
				row.Phone = rec.Phone
				row.Email = rec.Email
				row.MemberID = rec.InsuranceMemberID
			} else if err != nil {
				slog.Warn("insurance_checks: ddb get missed",
					"submission_uuid", *m.SubmissionUUID, "err", err)
			}
		}
		out = append(out, row)
	}
	return out
}

func applyChecksTextFilter(rows []insuranceCheckRow, q string) []insuranceCheckRow {
	if q == "" {
		return rows
	}
	q = strings.ToLower(q)
	out := rows[:0]
	for _, r := range rows {
		if strings.Contains(strings.ToLower(r.FirstName), q) ||
			strings.Contains(strings.ToLower(r.LastName), q) ||
			strings.Contains(strings.ToLower(r.Email), q) ||
			strings.Contains(strings.ToLower(r.Phone), q) ||
			strings.Contains(strings.ToLower(r.PayerName), q) {
			out = append(out, r)
		}
	}
	return out
}

func (h *AdminInsuranceChecksHandler) auditBulk(ctx context.Context, r *http.Request, action string, rows []insuranceCheckRow) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		return
	}
	for _, row := range rows {
		// Only audit rows that actually exposed PHI (i.e. were hydrated).
		if row.FirstName == "" && row.LastName == "" && row.Email == "" {
			continue
		}
		admin.LogPHIAccess(ctx, h.Pool, r, u, action, "insurance_checks_phi_access", row.CheckUUID)
	}
}

// List handles GET /admin/api/insurance-checks.
func (h *AdminInsuranceChecksHandler) List(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}
	f, err := parseInsuranceCheckFilters(r, 25, 200)
	if err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}

	fetch := f.Limit
	if f.Q != "" {
		fetch = f.Limit * 4
		if fetch > 200 {
			fetch = 200
		}
	}

	metas, total, err := h.loadChecks(r.Context(), f, fetch)
	if err != nil {
		slog.Error("insurance_checks list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	rows := h.hydrateChecks(r.Context(), metas)
	rows = applyChecksTextFilter(rows, f.Q)
	if len(rows) > f.Limit {
		rows = rows[:f.Limit]
	}

	h.auditBulk(r.Context(), r, "view_insurance_checks_list", rows)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"items": rows,
		"total": total,
		"page":  (f.Offset / f.Limit) + 1,
		"limit": f.Limit,
	})
}

// ExportCSV handles GET /admin/api/insurance-checks.csv.
func (h *AdminInsuranceChecksHandler) ExportCSV(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}
	f, err := parseInsuranceCheckFilters(r, 5000, 5000)
	if err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}
	f.Limit = 5000
	f.Offset = 0

	metas, _, err := h.loadChecks(r.Context(), f, 5000)
	if err != nil {
		slog.Error("insurance_checks csv", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	rows := h.hydrateChecks(r.Context(), metas)
	rows = applyChecksTextFilter(rows, f.Q)

	h.auditBulk(r.Context(), r, "export_insurance_checks_csv", rows)

	filename := fmt.Sprintf("insurance-checks-%s.csv", time.Now().UTC().Format("2006-01-02"))
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="`+filename+`"`)
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")

	cw := csv.NewWriter(w)
	_ = cw.Write([]string{
		"Check UUID", "Submission UUID", "Checked At", "Source",
		"First Name", "Last Name", "Date of Birth", "Phone", "Email",
		"Insurance (Payer)", "Insurance ID Number",
		"Coverage Status", "Eligible",
	})
	for _, r := range rows {
		_ = cw.Write([]string{
			r.CheckUUID, r.SubmissionUUID, r.CreatedAt, r.SourceLabel,
			r.FirstName, r.LastName, r.DateOfBirth, r.Phone, r.Email,
			r.PayerName, r.MemberID,
			r.CoverageStatus, fmt.Sprint(r.Eligible),
		})
	}
	cw.Flush()
}
