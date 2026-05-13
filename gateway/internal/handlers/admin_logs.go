package handlers

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminLogsHandler proxies the AI service's SSE log stream out to the
// admin portal. Mounted at /admin/api/logs/ai behind RequireSuperadmin.
//
// Why a proxy (not a direct browser → AI connection): the AI service has
// no auth — it's network-internal. Putting the gateway in the middle keeps
// the auth boundary intact AND lets us record each viewer in
// admin_access_log §164.312(b).
type AdminLogsHandler struct {
	Pool         *pgxpool.Pool
	PHI          *phi.Store
	AIServiceURL string
}

func (h *AdminLogsHandler) StreamAI(w http.ResponseWriter, r *http.Request) {
	if h.AIServiceURL == "" {
		httpx.WriteError(w, http.StatusInternalServerError, "ai service not configured")
		return
	}

	// SSE needs streaming; bail early if the runtime can't flush.
	flusher, ok := w.(http.Flusher)
	if !ok {
		httpx.WriteError(w, http.StatusInternalServerError, "streaming unsupported")
		return
	}

	// Audit: one row per viewer connection. Resource id is fixed because
	// the stream itself is the resource, not a specific record.
	if u, ok := appmw.AdminFromContext(r.Context()); ok {
		admin.LogPHIAccess(r.Context(), h.PHI, r, u,
			"view_ai_logs_stream", "ai_logs", "stream")
	}

	// Long-lived upstream request — no timeout, but tied to the client's
	// context so disconnects propagate.
	upstreamCtx, cancel := context.WithCancel(r.Context())
	defer cancel()

	upstreamURL := h.AIServiceURL + "/internal/logs/stream"
	upstreamReq, err := http.NewRequestWithContext(upstreamCtx, http.MethodGet, upstreamURL, nil)
	if err != nil {
		slog.Error("admin logs: build upstream request", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	upstreamReq.Header.Set("Accept", "text/event-stream")

	// No client timeout — SSE is intentionally long-lived. We rely on
	// context cancellation when the browser disconnects.
	client := &http.Client{Timeout: 0}
	upstreamResp, err := client.Do(upstreamReq)
	if err != nil {
		slog.Warn("admin logs: dial upstream", "err", err)
		httpx.WriteError(w, http.StatusBadGateway, "ai service unreachable")
		return
	}
	defer upstreamResp.Body.Close()

	if upstreamResp.StatusCode != http.StatusOK {
		slog.Warn("admin logs: upstream status", "status", upstreamResp.StatusCode)
		httpx.WriteError(w, http.StatusBadGateway, "ai service upstream error")
		return
	}

	// SSE response headers. X-Accel-Buffering disables proxy buffering
	// (Traefik/nginx) so events reach the browser as they're written.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache, no-store")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	// Hand-rolled copy loop: read what's available, write, flush.
	// io.Copy doesn't know about flushing, so SSE clients see nothing
	// until the source buffer happens to break. With this loop, every
	// chunk hits the wire immediately.
	buf := make([]byte, 4096)
	for {
		n, readErr := upstreamResp.Body.Read(buf)
		if n > 0 {
			if _, werr := w.Write(buf[:n]); werr != nil {
				return
			}
			flusher.Flush()
		}
		if readErr != nil {
			if readErr != io.EOF {
				slog.Debug("admin logs: stream ended", "err", readErr)
			}
			return
		}
		// Yield a tick so a fast publisher doesn't starve the goroutine.
		// Net effect is negligible at our log rate.
		select {
		case <-r.Context().Done():
			return
		case <-time.After(0):
		}
	}
}
