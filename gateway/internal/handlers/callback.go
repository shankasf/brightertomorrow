package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
)

// callbackRequest is the body for /internal/callback/submit.
//
// Strict by design: a callback only needs the four fields below (plus the
// caller-set source). No DOB / email / address / sex / insurance — those
// belong to the appointment-booking flow, which has its own endpoint.
type callbackRequest struct {
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Phone     string `json:"phone"`
	Reason    string `json:"reason"`
	Source    string `json:"source,omitempty"`
}

var (
	errCallbackFirstName = errors.New("first_name must be 1–100 characters")
	errCallbackLastName  = errors.New("last_name must be 1–100 characters")
	errCallbackPhone     = errors.New("phone must be 1–50 characters")
	errCallbackReason    = errors.New("reason must be 1–500 characters")
	errCallbackSource    = errors.New("source must be at most 50 characters")
)

func (b *callbackRequest) normalize() {
	b.FirstName = strings.TrimSpace(b.FirstName)
	b.LastName = strings.TrimSpace(b.LastName)
	b.Phone = strings.TrimSpace(b.Phone)
	b.Reason = strings.TrimSpace(b.Reason)
	b.Source = strings.TrimSpace(b.Source)
}

func (b *callbackRequest) validate() error {
	if l := utf8.RuneCountInString(b.FirstName); l < 1 || l > 100 {
		return errCallbackFirstName
	}
	if l := utf8.RuneCountInString(b.LastName); l < 1 || l > 100 {
		return errCallbackLastName
	}
	if l := utf8.RuneCountInString(b.Phone); l < 1 || l > 50 {
		return errCallbackPhone
	}
	if l := utf8.RuneCountInString(b.Reason); l < 1 || l > 500 {
		return errCallbackReason
	}
	if utf8.RuneCountInString(b.Source) > 50 {
		return errCallbackSource
	}
	return nil
}

// CallbackInternalHandler serves POST /internal/callback/submit.
// Internal endpoint — no public route. Reachable only from inside the bt
// namespace (the AI pod), same network-boundary auth model as the other
// /internal endpoints. See main.go's /internal route comment.
//
// Persistence: writes the PHI row (first_name, last_name, phone, reason)
// directly to DynamoDB bt-main via phi.Store. Postgres no longer touches
// this data — the Hostinger VPS is not BAA-covered and cannot legally
// hold raw patient PHI. See project_hostinger_not_hipaa memory.
type CallbackInternalHandler struct {
	PHI *phi.Store
}

func (h *CallbackInternalHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}

	var body callbackRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	body.normalize()
	if err := body.validate(); err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}

	source := body.Source
	if source == "" {
		source = "chat-agent"
	}

	now := time.Now().UTC()
	rec := phi.CallbackRecord{
		CallbackID:  uuid.NewString(),
		FirstName:   body.FirstName,
		LastName:    body.LastName,
		Phone:       body.Phone,
		Reason:      body.Reason,
		Source:      source,
		CreatedAt:   now,
		RetainUntil: now.AddDate(10, 0, 0), // Nevada NRS 629.051 — 10 years.
	}
	// Fail-closed: if DDB is unavailable, refuse the submission so the AI
	// retries instead of telling the visitor they're booked when the row
	// never landed.
	if err := h.PHI.PutCallback(r.Context(), rec); err != nil {
		slog.Error("callback: phi put failed", "err", err, "source", source)
		httpx.WriteError(w, http.StatusServiceUnavailable, "phi store unavailable")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"id": rec.CallbackID,
	})
}
