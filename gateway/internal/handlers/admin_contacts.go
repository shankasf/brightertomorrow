package handlers

import (
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminContactsHandler handles /admin/contacts endpoints.
type AdminContactsHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store
}

// List handles GET /admin/contacts.
// Returns paginated list. Message body is NOT included — minimum necessary §164.502(b).
// Use GET /admin/contacts/:id to retrieve the full record (which is PHI-logged).
func (h *AdminContactsHandler) List(w http.ResponseWriter, r *http.Request) {
	page, limit := parsePage(r)
	offset := (page - 1) * limit

	type contactRow struct {
		ID        int64   `json:"id"`
		FullName  string  `json:"full_name"`
		Email     string  `json:"email"`
		Phone     *string `json:"phone"`
		Subject   *string `json:"subject"`
		Source    *string `json:"source"`
		CreatedAt string  `json:"created_at"`
		PurgedAt  *string `json:"purged_at"`
	}

	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, full_name, email, phone, subject, source,
		        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
		        to_char(purged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS purged_at
		 FROM bt.contact_submissions
		 ORDER BY created_at DESC
		 LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		slog.Error("admin contacts list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()

	var contacts []contactRow
	for rows.Next() {
		var c contactRow
		if err := rows.Scan(&c.ID, &c.FullName, &c.Email, &c.Phone, &c.Subject, &c.Source, &c.CreatedAt, &c.PurgedAt); err != nil {
			slog.Error("admin contacts scan", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		contacts = append(contacts, c)
	}
	if contacts == nil {
		contacts = []contactRow{}
	}

	var total int
	_ = h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM bt.contact_submissions`).Scan(&total)

	httpx.WriteJSON(w, http.StatusOK, pageResponse(contacts, total, page, limit))
}

// Get handles GET /admin/contacts/:id.
// Full record including message body — PHI access is logged. §164.312(b)
func (h *AdminContactsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.WriteValidationError(w, "invalid id")
		return
	}

	type contactDetail struct {
		ID          int64   `json:"id"`
		FullName    string  `json:"full_name"`
		Email       string  `json:"email"`
		Phone       *string `json:"phone"`
		Subject     *string `json:"subject"`
		Message     string  `json:"message"`
		Source      *string `json:"source"`
		CreatedAt   string  `json:"created_at"`
		RetainUntil *string `json:"retain_until"`
		PurgedAt    *string `json:"purged_at"`
	}

	var c contactDetail
	err = h.Pool.QueryRow(r.Context(),
		`SELECT id, full_name, email, phone, subject, message, source,
		        to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		        to_char(retain_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		        to_char(purged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		 FROM bt.contact_submissions WHERE id = $1`, id,
	).Scan(&c.ID, &c.FullName, &c.Email, &c.Phone, &c.Subject, &c.Message,
		&c.Source, &c.CreatedAt, &c.RetainUntil, &c.PurgedAt)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}

	// HIPAA §164.312(b): log every admin PHI read.
	u, _ := appmw.AdminFromContext(r.Context())
	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "view_contact", "contact_submission", strconv.FormatInt(id, 10))

	httpx.WriteJSON(w, http.StatusOK, c)
}

// intakePointerRow is the non-PHI summary returned by ListIntakePointers.
//
// Note on `ID`: in the Postgres era this was the bigserial primary key.
// Now the DDB SubmissionUUID is the stable identifier, but we keep ID in
// the JSON shape so existing frontend code that uses it as a React key
// keeps working. Zero is fine — frontend de-dupes on SubmissionUUID.
type intakePointerRow struct {
	ID             int64  `json:"id"`
	SubmissionUUID string `json:"submission_uuid"`
	// EmailHash is returned so the UI can render a masked hint (first 8 hex chars).
	// It contains no identifying information on its own.
	EmailHash     string `json:"email_hash"`
	Flow          string `json:"flow"`
	PaymentMethod string `json:"payment_method"`
	Status        string `json:"status"`
	Source        string `json:"source"`
	CreatedAt     string `json:"created_at"`
}

// ListIntakePointers handles GET /admin/api/intake-pointers.
// Returns non-PHI pointer metadata only — §164.502(b) minimum necessary.
// Reads from DynamoDB bt-main (the Postgres bt.intake_pointers table
// has been dropped — project_hostinger_not_hipaa).
func (h *AdminContactsHandler) ListIntakePointers(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}
	page, limit := parsePage(r)
	offset := (page - 1) * limit

	recs, _, err := h.PHI.ListIntakePointers(r.Context(), phi.IntakeFilter{Limit: 10000})
	if err != nil {
		slog.Error("admin intake pointers list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	total := len(recs)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	slice := recs[offset:end]

	pointers := make([]intakePointerRow, 0, len(slice))
	for _, r := range slice {
		pointers = append(pointers, intakePointerRow{
			// Postgres-era schema had bigserial id; submission_uuid is the
			// stable identifier now. Frontend uses ID as a React key only.
			SubmissionUUID: r.SubmissionUUID,
			EmailHash:      r.EmailHash,
			Flow:           r.Flow,
			PaymentMethod:  r.PaymentMethod,
			Status:         r.CoverageStatus,
			Source:         r.Source,
			CreatedAt:      r.CreatedAt.UTC().Format(time.RFC3339),
		})
	}

	httpx.WriteJSON(w, http.StatusOK, pageResponse(pointers, total, page, limit))
}

// intakePointerDetail merges the Postgres pointer with the DynamoDB PHI record.
type intakePointerDetail struct {
	// Pointer fields (non-PHI).
	ID             int64  `json:"id"`
	SubmissionUUID string `json:"submission_uuid"`
	EmailHash      string `json:"email_hash"`
	Flow           string `json:"flow"`
	PaymentMethod  string `json:"payment_method"`
	Status         string `json:"status"`
	Source         string `json:"source"`
	CreatedAt      string `json:"created_at"`
	RetainUntil    string `json:"retain_until"`
	// PHI fields from DynamoDB.
	FirstName              string            `json:"first_name"`
	LastName               string            `json:"last_name"`
	DateOfBirth            string            `json:"date_of_birth"`
	Phone                  string            `json:"phone"`
	Email                  string            `json:"email"`
	HomeAddress            string            `json:"home_address"`
	Sex                    string            `json:"sex"`
	Service                string            `json:"service"`
	InsuranceName          string            `json:"insurance_name,omitempty"`
	InsuranceMemberID      string            `json:"insurance_member_id,omitempty"`
	SubscriberName         string            `json:"subscriber_name,omitempty"`
	SubscriberRelationship string            `json:"subscriber_relationship,omitempty"`
	Notes                  string            `json:"notes,omitempty"`
	Eligible               bool              `json:"eligible"`
	Coverage               map[string]string `json:"coverage,omitempty"`
}

// GetIntakePointer handles GET /admin/api/intake-pointers/{id}.
//
// `id` is now treated as the DDB submission_uuid (Postgres bigserial is
// gone). The handler locates the IntakeRecord on bt-main and returns the
// merged pointer + PHI shape. PHI access is logged. §164.312(b)
func (h *AdminContactsHandler) GetIntakePointer(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}
	submissionUUID := strings.TrimSpace(chi.URLParam(r, "id"))
	if submissionUUID == "" {
		httpx.WriteValidationError(w, "id is required")
		return
	}

	// Scan the GSI1 across all status buckets and match on submission_uuid.
	// At current scale (hundreds of intakes / year) this is one round-trip;
	// when the table grows past ~10k items add a GSI2 on submissionUuid.
	recs, _, err := h.PHI.ListIntakePointers(r.Context(), phi.IntakeFilter{Limit: 10000})
	if err != nil {
		slog.Error("admin intake pointer get: ddb list failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	var rec *phi.IntakeRecord
	for i := range recs {
		if recs[i].SubmissionUUID == submissionUUID {
			rec = &recs[i]
			break
		}
	}
	if rec == nil {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}

	u, _ := appmw.AdminFromContext(r.Context())
	admin.LogPHIAccess(r.Context(), h.PHI, r, u,
		"view_intake_phi", "intake_pointers_phi_access", rec.SubmissionUUID)

	detail := intakePointerDetail{
		SubmissionUUID: rec.SubmissionUUID,
		EmailHash:      rec.EmailHash,
		Flow:           rec.Flow,
		PaymentMethod:  rec.PaymentMethod,
		Status:         rec.CoverageStatus,
		Source:         rec.Source,
		CreatedAt:      rec.CreatedAt.UTC().Format(time.RFC3339),
		RetainUntil:    rec.RetainUntil.UTC().Format(time.RFC3339),
		// PHI from DynamoDB.
		FirstName:              rec.FirstName,
		LastName:               rec.LastName,
		DateOfBirth:            rec.DateOfBirth,
		Phone:                  rec.Phone,
		Email:                  rec.Email,
		HomeAddress:            rec.HomeAddress,
		Sex:                    rec.Sex,
		Service:                rec.Service,
		InsuranceName:          rec.InsuranceName,
		InsuranceMemberID:      rec.InsuranceMemberID,
		SubscriberName:         rec.SubscriberName,
		SubscriberRelationship: rec.SubscriberRelationship,
		Notes:                  rec.Notes,
		Eligible:               rec.Eligible,
		Coverage:               rec.Coverage,
	}

	httpx.WriteJSON(w, http.StatusOK, detail)
}

// parsePage returns page (1-based) and limit from query params with sane defaults.
func parsePage(r *http.Request) (page, limit int) {
	page, _ = strconv.Atoi(r.URL.Query().Get("page"))
	limit, _ = strconv.Atoi(r.URL.Query().Get("limit"))
	if page < 1 {
		page = 1
	}
	if limit < 1 || limit > 200 {
		limit = 25
	}
	return
}

// pageResponse wraps a slice with pagination metadata.
func pageResponse(data any, total, page, limit int) map[string]any {
	return map[string]any{
		"data":  data,
		"total": total,
		"page":  page,
		"limit": limit,
	}
}

