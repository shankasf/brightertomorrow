package handlers

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
)

// FrontendLogsHandler accepts batched browser log entries and re-emits each
// to gateway stdout as JSON, tagged service="frontend" so Vector ships them
// to S3 alongside backend logs. No PHI redaction (per solo-operator policy);
// rate-limited via the chi route to keep abuse cheap.
//
// Idempotency: each entry carries a client-generated log_id (UUID v4). Even
// if the browser retries the same POST, Vector treats duplicate log_ids as
// distinct rows — dedup happens at the Athena query layer (DISTINCT log_id)
// rather than here. Keeping this endpoint stateless is the right tradeoff.
type FrontendLogsHandler struct{}

// frontendLogEntry is the wire format. Required: log_id, level, message.
// Everything else is best-effort and forwarded as-is.
type frontendLogEntry struct {
	LogID     string         `json:"log_id"`
	Ts        string         `json:"ts"` // RFC3339 client timestamp; we trust it
	Level     string         `json:"level"`
	Message   string         `json:"message"`
	Logger    string         `json:"logger,omitempty"`
	SessionID string         `json:"session_id,omitempty"`
	URL       string         `json:"url,omitempty"`
	UserAgent string         `json:"user_agent,omitempty"`
	Attrs     map[string]any `json:"attrs,omitempty"`
}

type frontendLogBatch struct {
	Logs []frontendLogEntry `json:"logs"`
}

const (
	maxFrontendLogsPerBatch = 100
	maxFrontendMessageLen   = 8 * 1024 // 8 KB per message
)

func (h *FrontendLogsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		httpx.WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	// Cap request body — defense against abuse since this endpoint is
	// browser-callable (no auth required for log ingestion).
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20) // 1 MB

	var batch frontendLogBatch
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&batch); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid json body")
		return
	}
	if len(batch.Logs) == 0 {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if len(batch.Logs) > maxFrontendLogsPerBatch {
		httpx.WriteError(w, http.StatusBadRequest, "batch too large")
		return
	}

	// Real IP + user agent attached to every entry so the log is interpretable
	// without trusting the client to send them.
	realIP := r.Header.Get("X-Real-IP")
	if realIP == "" {
		realIP = r.RemoteAddr
	}
	defaultUA := r.UserAgent()

	for _, e := range batch.Logs {
		// Validate + normalize.
		if e.LogID == "" || len(e.LogID) > 64 {
			continue // skip silently — best-effort logger
		}
		if e.Message == "" {
			continue
		}
		if len(e.Message) > maxFrontendMessageLen {
			e.Message = e.Message[:maxFrontendMessageLen] + "...(truncated)"
		}
		level := strings.ToUpper(strings.TrimSpace(e.Level))
		switch level {
		case "DEBUG", "INFO", "WARN", "WARNING", "ERROR":
			// ok
		default:
			level = "INFO"
		}
		ua := e.UserAgent
		if ua == "" {
			ua = defaultUA
		}

		// Use ts as-is if it parses; otherwise stamp now().
		ts := e.Ts
		if _, err := time.Parse(time.RFC3339, ts); err != nil {
			ts = time.Now().UTC().Format(time.RFC3339)
		}

		// Emit as a structured JSON line. The "service":"frontend" key is
		// what Vector keys off in the remap transform — overrides the
		// kubernetes.pod_labels.app default (which would be "bt-gateway"
		// since this re-emit happens inside the gateway pod).
		fields := []any{
			"service", "frontend",
			"log_id", e.LogID,
			"ts", ts,
			"level", level,
			"msg", e.Message,
		}
		if e.Logger != "" {
			fields = append(fields, "logger", e.Logger)
		}
		if e.SessionID != "" {
			fields = append(fields, "session_id", e.SessionID)
		}
		if e.URL != "" {
			fields = append(fields, "url", e.URL)
		}
		if ua != "" {
			fields = append(fields, "user_agent", ua)
		}
		if realIP != "" {
			fields = append(fields, "remote_ip", realIP)
		}
		for k, v := range e.Attrs {
			if strings.HasPrefix(k, "_") {
				continue // reserved prefix
			}
			fields = append(fields, "attr_"+k, v)
		}

		// slog's level mapping. Default JSON handler is set in main.go and
		// writes one line per call — exactly what Vector tails.
		switch level {
		case "DEBUG":
			slog.Debug("frontend_log", fields...)
		case "WARN", "WARNING":
			slog.Warn("frontend_log", fields...)
		case "ERROR":
			slog.Error("frontend_log", fields...)
		default:
			slog.Info("frontend_log", fields...)
		}
	}

	w.WriteHeader(http.StatusNoContent)
}
