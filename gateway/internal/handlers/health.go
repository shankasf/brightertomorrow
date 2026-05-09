package handlers

import (
	"context"
	"net/http"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Health handles GET /healthz — always 200, no DB dependency.
func Health(w http.ResponseWriter, r *http.Request) {
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// phiPinger is the subset of phi.Store used for the readyz check.
// Defined by the consumer (this package), not the producer.
type phiPinger interface {
	Ping(ctx context.Context) error
}

// ReadyzHandler checks both the database and the PHI store connections.
type ReadyzHandler struct {
	Pool *pgxpool.Pool
	PHI  phiPinger
}

// ServeHTTP handles GET /readyz. Returns 503 if either the DB or the
// DynamoDB PHI store cannot be reached.
func (h *ReadyzHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if err := h.Pool.Ping(r.Context()); err != nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "database unavailable")
		return
	}
	if h.PHI != nil {
		if err := h.PHI.Ping(r.Context()); err != nil {
			httpx.WriteError(w, http.StatusServiceUnavailable, "phi store unavailable")
			return
		}
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
