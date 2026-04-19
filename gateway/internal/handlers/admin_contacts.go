package handlers

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminContactsHandler handles /admin/contacts endpoints.
type AdminContactsHandler struct {
	Pool *pgxpool.Pool
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
