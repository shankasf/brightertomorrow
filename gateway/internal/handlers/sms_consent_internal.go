// sms_consent_internal.go — POST /internal/sms/consent
//
// Records an SMS opt-in/opt-out captured by the AI chat or voice agent. The
// web forms (contact, booking) record consent inline on their own handlers;
// this endpoint exists for the conversational channels, which call it after
// the caller answers the opt-in question.
//
// Cluster-internal only (no ingress rule) + X-Internal-Secret gate. The
// gateway owns the DynamoDB write and the PHI audit row; the AI side just
// forwards {phone, opted_in, method, session_id}.
package handlers

import (
	"log/slog"
	"net/http"
	"strings"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
)

// SMSConsentInternalHandler serves POST /internal/sms/consent.
type SMSConsentInternalHandler struct {
	PHI            *phi.Store
	InternalSecret string
}

type smsConsentRequest struct {
	Phone     string `json:"phone"`
	OptedIn   bool   `json:"opted_in"`
	Method    string `json:"method"` // chat | voice (web_* used by the form handlers)
	SessionID string `json:"session_id"`
	Source    string `json:"source"` // chat-agent | voice-agent | voice-phone
}

func (h *SMSConsentInternalHandler) checkSecret(w http.ResponseWriter, r *http.Request) bool {
	if h.InternalSecret == "" {
		return true // dev mode — no secret configured
	}
	if r.Header.Get("X-Internal-Secret") != h.InternalSecret {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return false
	}
	return true
}

func (h *SMSConsentInternalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if !h.checkSecret(w, r) {
		return
	}
	var body smsConsentRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}

	if strings.TrimSpace(body.Phone) == "" {
		httpx.WriteValidationError(w, "phone is required")
		return
	}
	// Only the conversational methods are valid on this endpoint; the web
	// methods are recorded by the contact/booking handlers themselves.
	method := strings.TrimSpace(body.Method)
	if method != phi.SMSMethodChat && method != phi.SMSMethodVoice {
		httpx.WriteValidationError(w, "method must be chat or voice")
		return
	}

	if err := h.PHI.PutSMSConsent(r.Context(), phi.SMSConsentInput{
		Phone:     body.Phone,
		OptedIn:   body.OptedIn,
		Method:    method,
		Source:    body.Source,
		SessionID: body.SessionID,
	}); err != nil {
		// Do not echo internal error text. No PHI in the log line.
		slog.Error("sms consent: store failed", "err", err, "method", method, "opted_in", body.OptedIn)
		httpx.WriteError(w, http.StatusInternalServerError, "failed to record consent")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
