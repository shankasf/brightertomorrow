package handlers

import (
	"net/http"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Health handles GET /healthz — always 200, no DB dependency.
func Health(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ReadyzHandler checks the database connection.
type ReadyzHandler struct {
	Pool *pgxpool.Pool
}

// ServeHTTP handles GET /readyz. Returns 503 if the DB cannot be reached.
func (h *ReadyzHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h.Pool.Ping(r.Context()); err != nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
