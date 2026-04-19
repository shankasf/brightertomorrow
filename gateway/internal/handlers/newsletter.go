package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/jackc/pgx/v5/pgxpool"
)

var newsletterEmailRE = regexp.MustCompile(`(?i)^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$`)

var errNewsletterEmail = errors.New("email must be valid and at most 200 characters")

type newsletterRequest struct {
	Email string `json:"email"`
}

func (b *newsletterRequest) validate() error {
	if l := utf8.RuneCountInString(b.Email); l < 1 || l > 200 || !newsletterEmailRE.MatchString(b.Email) {
		return errNewsletterEmail
	}
	return nil
}

// NewsletterHandler handles POST /v1/newsletter.
type NewsletterHandler struct {
	Pool *pgxpool.Pool
}

func (h *NewsletterHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body newsletterRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}

	if err := body.validate(); err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}

	email := strings.ToLower(strings.TrimSpace(body.Email))

	const query = `
		INSERT INTO bt.newsletter_subscribers (email)
		VALUES ($1)
		ON CONFLICT (email) DO NOTHING`

	if _, err := h.Pool.Exec(r.Context(), query, email); err != nil {
		slog.Error("newsletter: insert", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
