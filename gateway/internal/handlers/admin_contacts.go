package handlers

import (
	"context"
	"log/slog"
	"net/http"
	"strconv"

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
	PHI  phiReader
}

// phiReader is the subset of phi.Store used by the admin contacts handler.
// Defined by the consumer (this package), not the producer.
type phiReader interface {
	GetIntake(ctx context.Context, emailHash, submissionUUID string) (*phi.IntakeRecord, error)
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
		        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at,
		        to_char(purged_at,  'YYYY-MM-DD"T"HH24:MI:SSOF') AS purged_at
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
		        to_char(created_at,   'YYYY-MM-DD"T"HH24:MI:SSOF'),
		        to_char(retain_until, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
		        to_char(purged_at,    'YYYY-MM-DD"T"HH24:MI:SSOF')
		 FROM bt.contact_submissions WHERE id = $1`, id,
	).Scan(&c.ID, &c.FullName, &c.Email, &c.Phone, &c.Subject, &c.Message,
		&c.Source, &c.CreatedAt, &c.RetainUntil, &c.PurgedAt)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}

	// HIPAA §164.312(b): log every admin PHI read.
	u, _ := appmw.AdminFromContext(r.Context())
	admin.LogPHIAccess(r.Context(), h.Pool, r, u, "view_contact", "contact_submission", strconv.FormatInt(id, 10))

	httpx.WriteJSON(w, http.StatusOK, c)
}

// intakePointerRow is the non-PHI summary returned by ListIntakePointers.
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
func (h *AdminContactsHandler) ListIntakePointers(w http.ResponseWriter, r *http.Request) {
	page, limit := parsePage(r)
	offset := (page - 1) * limit

	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, submission_uuid, email_hash, flow, payment_method, status, source,
		        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS created_at
		 FROM bt.intake_pointers
		 ORDER BY created_at DESC
		 LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		slog.Error("admin intake pointers list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()

	var pointers []intakePointerRow
	for rows.Next() {
		var p intakePointerRow
		if err := rows.Scan(
			&p.ID, &p.SubmissionUUID, &p.EmailHash,
			&p.Flow, &p.PaymentMethod, &p.Status, &p.Source, &p.CreatedAt,
		); err != nil {
			slog.Error("admin intake pointers scan", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		pointers = append(pointers, p)
	}
	if pointers == nil {
		pointers = []intakePointerRow{}
	}

	var total int
	_ = h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM bt.intake_pointers`).Scan(&total)

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
// Fetches the pointer row from Postgres, then retrieves the full PHI record
// from DynamoDB. PHI access is logged. §164.312(b)
func (h *AdminContactsHandler) GetIntakePointer(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.WriteValidationError(w, "invalid id")
		return
	}

	// Step 1: fetch the non-PHI pointer row.
	type pointerMeta struct {
		ID             int64
		SubmissionUUID string
		EmailHash      string
		Flow           string
		PaymentMethod  string
		Status         string
		Source         string
		CreatedAt      string
		RetainUntil    string
	}
	var ptr pointerMeta
	err = h.Pool.QueryRow(r.Context(),
		`SELECT id, submission_uuid, email_hash, flow, payment_method, status, source,
		        to_char(created_at,   'YYYY-MM-DD"T"HH24:MI:SSOF'),
		        to_char(retain_until, 'YYYY-MM-DD"T"HH24:MI:SSOF')
		 FROM bt.intake_pointers WHERE id = $1`, id,
	).Scan(
		&ptr.ID, &ptr.SubmissionUUID, &ptr.EmailHash,
		&ptr.Flow, &ptr.PaymentMethod, &ptr.Status, &ptr.Source,
		&ptr.CreatedAt, &ptr.RetainUntil,
	)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}

	// Step 2: fetch PHI from DynamoDB.
	if h.PHI == nil {
		slog.Error("admin intake pointer get: PHI store not configured")
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}
	rec, err := h.PHI.GetIntake(r.Context(), ptr.EmailHash, ptr.SubmissionUUID)
	if err != nil {
		slog.Error("admin intake pointer get: dynamo fetch failed",
			"err", err,
			"submission_uuid", ptr.SubmissionUUID,
		)
		httpx.WriteError(w, http.StatusInternalServerError, "could not retrieve PHI record")
		return
	}

	// Step 3: log PHI access. §164.312(b)
	u, _ := appmw.AdminFromContext(r.Context())
	admin.LogPHIAccess(r.Context(), h.Pool, r, u,
		"view_intake_phi", "intake_pointers_phi_access", ptr.SubmissionUUID)

	detail := intakePointerDetail{
		ID:             ptr.ID,
		SubmissionUUID: ptr.SubmissionUUID,
		EmailHash:      ptr.EmailHash,
		Flow:           ptr.Flow,
		PaymentMethod:  ptr.PaymentMethod,
		Status:         ptr.Status,
		Source:         ptr.Source,
		CreatedAt:      ptr.CreatedAt,
		RetainUntil:    ptr.RetainUntil,
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

