package handlers

import (
	"log/slog"
	"net/http"
	"strconv"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminNewsletterHandler handles /admin/newsletter endpoints.
type AdminNewsletterHandler struct {
	Pool *pgxpool.Pool
}

// List handles GET /admin/newsletter.
func (h *AdminNewsletterHandler) List(w http.ResponseWriter, r *http.Request) {
	page, limit := parsePage(r)
	offset := (page - 1) * limit

	type subRow struct {
		ID                 int64   `json:"id"`
		Email              string  `json:"email"`
		CreatedAt          string  `json:"created_at"`
		UnsubscribedAt     *string `json:"unsubscribed_at"`
		DeletionRequestedAt *string `json:"deletion_requested_at"`
	}

	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, email,
		        to_char(created_at,             'YYYY-MM-DD"T"HH24:MI:SSOF'),
		        to_char(unsubscribed_at,         'YYYY-MM-DD"T"HH24:MI:SSOF'),
		        to_char(deletion_requested_at,   'YYYY-MM-DD"T"HH24:MI:SSOF')
		 FROM bt.newsletter_subscribers
		 ORDER BY created_at DESC
		 LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		slog.Error("admin newsletter list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()

	var subs []subRow
	for rows.Next() {
		var s subRow
		if err := rows.Scan(&s.ID, &s.Email, &s.CreatedAt, &s.UnsubscribedAt, &s.DeletionRequestedAt); err != nil {
			slog.Error("admin newsletter scan", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		subs = append(subs, s)
	}
	if subs == nil {
		subs = []subRow{}
	}

	var total int
	_ = h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM bt.newsletter_subscribers`).Scan(&total)

	httpx.WriteJSON(w, http.StatusOK, pageResponse(subs, total, page, limit))
}

// Unsubscribe handles DELETE /admin/newsletter/:id.
func (h *AdminNewsletterHandler) Unsubscribe(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.WriteValidationError(w, "invalid id")
		return
	}

	tag, err := h.Pool.Exec(r.Context(),
		`UPDATE bt.newsletter_subscribers SET unsubscribed_at=now() WHERE id=$1 AND unsubscribed_at IS NULL`, id)
	if err != nil {
		slog.Error("admin newsletter unsubscribe", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found or already unsubscribed")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// RequestDeletion handles POST /admin/newsletter/:id/request-deletion.
// Marks a subscriber for Nevada NRS 603A right-to-erasure processing.
func (h *AdminNewsletterHandler) RequestDeletion(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.WriteValidationError(w, "invalid id")
		return
	}

	tag, err := h.Pool.Exec(r.Context(),
		`UPDATE bt.newsletter_subscribers SET deletion_requested_at=now() WHERE id=$1 AND deletion_requested_at IS NULL`, id)
	if err != nil {
		slog.Error("admin newsletter deletion_request", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if tag.RowsAffected() == 0 {
		httpx.WriteError(w, http.StatusNotFound, "not found or already requested")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
