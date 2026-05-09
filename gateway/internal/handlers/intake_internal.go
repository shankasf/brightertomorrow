package handlers

import (
	"errors"
	"net/http"
	"strings"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
)

// validInternalSources lists the source values accepted from trusted callers.
var validInternalSources = map[string]struct{}{
	"chat-agent":            {},
	"voice-agent":           {},
	"website-booking-flow":  {},
	"website-coverage-flow": {},
}

var errIntakeSource = errors.New("source must be chat-agent, voice-agent, website-booking-flow, or website-coverage-flow")

// IntakeInternalHandler serves the SigV4-trusted internal intake endpoint.
// It delegates to IntakeHandler.submit, sharing all validation and persistence
// logic. The only differences from the public endpoint:
//   - No rate limit (applied at the router level, not here).
//   - Source is taken from the request body rather than derived from flow.
type IntakeInternalHandler struct {
	// Embed gives us access to submit() and all shared state.
	*IntakeHandler
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
	httpx.WriteJSON(w, status, resp)
}
