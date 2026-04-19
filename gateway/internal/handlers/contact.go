package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"unicode/utf8"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/jackc/pgx/v5/pgxpool"
)

var emailRE = regexp.MustCompile(`(?i)^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$`)

type contactRequest struct {
	FullName string `json:"full_name"`
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Subject  string `json:"subject"`
	Message  string `json:"message"`
}

var (
	errContactFullName = errors.New("full_name must be 1–200 characters")
	errContactEmail    = errors.New("email must be valid and at most 200 characters")
	errContactPhone    = errors.New("phone must be at most 50 characters")
	errContactSubject  = errors.New("subject must be at most 200 characters")
	errContactMessage  = errors.New("message must be 1–5000 characters")
)

func (b *contactRequest) validate() error {
	if l := utf8.RuneCountInString(b.FullName); l < 1 || l > 200 {
		return errContactFullName
	}
	if l := utf8.RuneCountInString(b.Email); l < 1 || l > 200 || !emailRE.MatchString(b.Email) {
		return errContactEmail
	}
	if utf8.RuneCountInString(b.Phone) > 50 {
		return errContactPhone
	}
	if utf8.RuneCountInString(b.Subject) > 200 {
		return errContactSubject
	}
	if l := utf8.RuneCountInString(b.Message); l < 1 || l > 5000 {
		return errContactMessage
	}
	return nil
}

// ContactHandler handles POST /v1/contact.
type ContactHandler struct {
	Pool *pgxpool.Pool
}

func (h *ContactHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body contactRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}

	if err := body.validate(); err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}

	phone := nullableString(body.Phone)
	subject := nullableString(body.Subject)

	// IP and user_agent removed — HIPAA minimum-necessary (§164.502(b)).
	// No documented clinical need; storing IP + health-context message = linkable PHI.
	const query = `
		INSERT INTO bt.contact_submissions
			(full_name, email, phone, subject, message, source)
		VALUES ($1,$2,$3,$4,$5,'website')`

	if _, err := h.Pool.Exec(r.Context(), query,
		body.FullName, body.Email, phone, subject, body.Message,
	); err != nil {
		slog.Error("contact: insert", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// nullableString returns nil when s is empty, otherwise a pointer to s.
func nullableString(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
