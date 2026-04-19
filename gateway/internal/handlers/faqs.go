package handlers

import (
	"log/slog"
	"net/http"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/jackc/pgx/v5/pgxpool"
)

// faqRow is the shape returned to callers — matches the existing web API response.
type faqRow struct {
	ID       int64  `json:"id"`
	Question string `json:"question"`
	Answer   string `json:"answer"`
	Category string `json:"category"`
}

// FAQsHandler handles GET /v1/faqs.
type FAQsHandler struct {
	Pool *pgxpool.Pool
}

func (h *FAQsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	const query = `
		SELECT id, question, answer, COALESCE(category, '') AS category
		FROM bt.faqs
		WHERE published
		ORDER BY position`

	rows, err := h.Pool.Query(r.Context(), query)
	if err != nil {
		slog.Error("faqs: query", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()

	faqs := make([]faqRow, 0, 16)
	for rows.Next() {
		var f faqRow
		if err := rows.Scan(&f.ID, &f.Question, &f.Answer, &f.Category); err != nil {
			slog.Error("faqs: scan", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		faqs = append(faqs, f)
	}
	if err := rows.Err(); err != nil {
		slog.Error("faqs: rows", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// FAQs change rarely — tell browsers and Traefik to cache for 5 min,
	// serve stale for up to 1 hour while revalidating in the background.
	w.Header().Set("Cache-Control", "public, max-age=300, stale-while-revalidate=3600")
	httpx.WriteJSON(w, http.StatusOK, faqs)
}
