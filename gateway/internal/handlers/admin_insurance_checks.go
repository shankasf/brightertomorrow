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
// Reads InsuranceCheckSummary rows from DynamoDB bt-main (BAA-covered).
// Patient name / DOB / phone / email / member ID live on the
// InsuranceCheckRecord itself; for rows linked to a booking we still call
// BatchGetIntakes to overlay any fresher contact details captured at
// booking time (e.g. the visitor typed a phone after coverage check).
//
// HIPAA: every list / export / detail call writes one access_log row per
// PHI record returned, so "who looked up which check, when" is auditable.
type AdminInsuranceChecksHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store
}

// insuranceCheckRow is the merged shape returned to admins.
type insuranceCheckRow struct {
	ID             string `json:"id"`
	CheckUUID      string `json:"check_uuid"`
	SubmissionUUID string `json:"submission_uuid,omitempty"`
	CreatedAt      string `json:"created_at"`
	Source         string `json:"source"`
	SourceLabel    string `json:"source_label"`
	PayerName      string `json:"payer_name"`
	CoverageStatus string `json:"coverage_status"`
	Eligible       bool   `json:"eligible"`
	// PHI hydrated from DDB (omitted when no submission_uuid is linked).
	FirstName   string `json:"first_name,omitempty"`
	LastName    string `json:"last_name,omitempty"`
	DateOfBirth string `json:"date_of_birth,omitempty"`
	Phone       string `json:"phone,omitempty"`
	Email       string `json:"email,omitempty"`
	MemberID    string `json:"insurance_member_id,omitempty"`
}

type insuranceCheckFilters struct {
	From   *time.Time
	To     *time.Time
	Source string // friendly: chatbot | voice | phone | website
	Status string // verified | unverified | error
	Q      string
	Limit  int
	Offset int
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
	case "", "all", "chatbot", "voice", "phone", "website":
	default:
		return f, fmt.Errorf("invalid 'source' — expected chatbot, voice, phone, website, or all")
	}
	switch f.Status {
	case "", "all", "verified", "unverified", "error":
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

// fetchChecks queries DDB for InsuranceCheckSummary, then hydrates the
// linked intake PHI via BatchGetIntakes. Returns the full filtered set
// (caller paginates the slice).
func (h *AdminInsuranceChecksHandler) fetchChecks(ctx context.Context, f insuranceCheckFilters) ([]insuranceCheckRow, error) {
	pf := phi.InsuranceCheckFilter{
		From:    f.From,
		To:      f.To,
		Sources: sourcesForFriendly(f.Source),
		Status:  f.Status,
		Limit:   10000,
	}
	if f.Status == "all" {
		pf.Status = ""
	}

	summaries, _, err := h.PHI.ListInsuranceChecks(ctx, pf)
	if err != nil {
		return nil, err
	}

	// Hydrate linked intakes in one BatchGetItem.
	keys := make([]phi.IntakeKey, 0, len(summaries))
	for _, s := range summaries {
		if s.SubmissionUUID != "" && s.EmailHash != "" {
			keys = append(keys, phi.IntakeKey{EmailHash: s.EmailHash, SubmissionUUID: s.SubmissionUUID})
		}
	}
	recs := map[string]*phi.IntakeRecord{}
	if len(keys) > 0 {
		got, gerr := h.PHI.BatchGetIntakes(ctx, keys)
		if gerr != nil {
			slog.Error("insurance_checks: ddb batch get failed", "err", gerr, "n", len(keys))
		} else {
			recs = got
		}
	}

	needle := strings.ToLower(strings.TrimSpace(f.Q))
	rows := make([]insuranceCheckRow, 0, len(summaries))
	for _, s := range summaries {
		row := insuranceCheckRow{
			ID:             s.CheckUUID,
			CheckUUID:      s.CheckUUID,
			SubmissionUUID: s.SubmissionUUID,
			CreatedAt:      s.CreatedAt.UTC().Format(time.RFC3339),
			Source:         s.Source,
			SourceLabel:    sourceLabel(s.Source),
			PayerName:      s.PayerName,
			CoverageStatus: s.CoverageStatus,
			Eligible:       s.Eligible,
			FirstName:      s.FirstName,
			LastName:       s.LastName,
			DateOfBirth:    s.DateOfBirth,
			Phone:          s.Phone,
			Email:          s.Email,
			MemberID:       s.MemberID,
		}
		// For booking-linked checks, overlay any fresher contact details
		// captured at booking time (e.g. phone added after the coverage
		// step). Record fields are kept as the fallback so older standalone
		// checks still render even if the IntakeRecord lacks a field.
		if s.SubmissionUUID != "" {
			if rec, ok := recs[s.SubmissionUUID]; ok && rec != nil {
				if rec.FirstName != "" {
					row.FirstName = rec.FirstName
				}
				if rec.LastName != "" {
					row.LastName = rec.LastName
				}
				if rec.DateOfBirth != "" {
					row.DateOfBirth = rec.DateOfBirth
				}
				if rec.Phone != "" {
					row.Phone = rec.Phone
				}
				if rec.Email != "" {
					row.Email = rec.Email
				}
				if rec.InsuranceMemberID != "" {
					row.MemberID = rec.InsuranceMemberID
				}
			}
		}
		if needle != "" {
			hay := strings.ToLower(row.FirstName + " " + row.LastName + " " + row.Email + " " + row.Phone + " " + row.PayerName)
			if !strings.Contains(hay, needle) {
				continue
			}
		}
		rows = append(rows, row)
	}
	return rows, nil
}

func (h *AdminInsuranceChecksHandler) auditBulk(r *http.Request, action string, rows []insuranceCheckRow) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		return
	}
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		// Only audit rows that actually exposed PHI (i.e. were hydrated).
		if row.FirstName == "" && row.LastName == "" && row.Email == "" {
			continue
		}
		ids = append(ids, row.CheckUUID)
	}
	admin.LogPHIAccessBatch(r.Context(), h.PHI, r, u, action, "insurance_checks_phi_access", ids)
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

	all, err := h.fetchChecks(r.Context(), f)
	if err != nil {
		slog.Error("insurance_checks list", "err", err)
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

	h.auditBulk(r, "view_insurance_checks_list", rows)

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

	rows, err := h.fetchChecks(r.Context(), f)
	if err != nil {
		slog.Error("insurance_checks csv", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	h.auditBulk(r, "export_insurance_checks_csv", rows)

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

// CanonicalCoverageStatus collapses any upstream/internal status string into
// one of three admin-facing values: "verified", "unverified", "error".
// Stored in InsuranceCheckRecord.CoverageStatus as the source of truth for
// admin filtering and display.
func CanonicalCoverageStatus(raw string, eligible bool) string {
	if eligible {
		return "verified"
	}
	if strings.EqualFold(strings.TrimSpace(raw), "verification_error") {
		return "error"
	}
	return "unverified"
}

// IntakeBucketFromCanonical maps the admin-facing canonical status (used on
// InsuranceCheckRecord) back to the intake-side bucket used on IntakeRecord
// and GSI1PK (STATUS#<bucket>). Without this mapping, an intake row that
// reuses a same-session insurance check ends up with coverageStatus="verified"
// — a value that ListIntakePointers never queries, so the appointment is
// invisible on /admin/appointments. Inverse of CanonicalCoverageStatus.
func IntakeBucketFromCanonical(canonical string, eligible bool) string {
	if eligible {
		return phi.StatusEligible
	}
	switch strings.ToLower(strings.TrimSpace(canonical)) {
	case "error", "verification_error":
		return phi.StatusVerificationError
	case "verified", "eligible":
		// Edge: eligible=false but canonical says verified — treat as needs_review.
		return phi.StatusNeedsReview
	default:
		return phi.StatusNeedsReview
	}
}
