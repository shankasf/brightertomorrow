package handlers

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
)

// validInternalSources lists the source values accepted from trusted callers.
//
// voice-agent  — browser WebRTC widget on the public site.
// voice-phone  — PSTN call routed in via Twilio Media Streams.
var validInternalSources = map[string]struct{}{
	"chat-agent":            {},
	"voice-agent":           {},
	"voice-phone":           {},
	"website-booking-flow":  {},
	"website-coverage-flow": {},
}

var errIntakeSource = errors.New("source must be chat-agent, voice-agent, voice-phone, website-booking-flow, or website-coverage-flow")

// IntakeInternalHandler serves the SigV4-trusted internal intake endpoint.
// It delegates to IntakeHandler.submit, sharing all validation and persistence
// logic. The only differences from the public endpoint:
//   - No rate limit (applied at the router level, not here).
//   - Source is taken from the request body rather than derived from flow.
//   - Enqueues a best-effort patient ACK email after successful persistence.
type IntakeInternalHandler struct {
	// Embed gives us access to submit() and all shared state.
	*IntakeHandler
	Notify        *phi.NotificationStore // optional; nil → notifications silently skipped
	NotifyEnabled bool                   // gates enqueue; default false (BT_APPOINTMENT_NOTIFY_ENABLED)
}

// ServeHTTP handles POST /internal/intake/submit.
func (h *IntakeInternalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body intakeRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	body.normalize()

	if err := body.validate(); err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}

	// Internal callers supply source explicitly.
	src := strings.ToLower(strings.TrimSpace(body.Source))
	if _, ok := validInternalSources[src]; !ok {
		httpx.WriteValidationError(w, errIntakeSource.Error())
		return
	}
	body.Source = src

	resp, status, err := h.submit(r.Context(), body)
	if err != nil {
		httpx.WriteError(w, status, err.Error())
		return
	}

	// Best-effort ACK email — never fail the intake over a missed notification.
	// No PHI in logs: only submission_uuid and channel.
	// TODO(sms): enqueue sms channel when Twilio is enabled.
	if h.NotifyEnabled && h.Notify != nil {
		if email := strings.TrimSpace(body.Email); email != "" {
			greeting := notifyGreeting(strings.TrimSpace(body.FirstName))
			subj, heading, paragraphs, details := buildRequestAckContent(greeting)
			dedupeKey := fmt.Sprintf("intakeack:%s:email", resp.SubmissionUUID)
			enqueueEmail(r.Context(), h.Notify, email, subj, heading, paragraphs, details, false, dedupeKey, resp.SubmissionUUID)
			slog.Info("intake internal: ACK email enqueued",
				"submission_uuid", resp.SubmissionUUID, "channel", "email")
		}
	}

	httpx.WriteJSON(w, status, resp)
}
