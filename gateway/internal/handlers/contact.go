package handlers

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5/pgxpool"
)

var emailRE = regexp.MustCompile(`(?i)^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$`)

type contactRequest struct {
	FullName string `json:"full_name"`
	Email    string `json:"email"`
	Phone    string `json:"phone"`
	Subject  string `json:"subject"`
	Message  string `json:"message"`

	// Discrete form fields (migration 025). All optional — stored NULL when
	// blank so the admin portal can render every field the visitor typed.
	FirstName              string `json:"first_name"`
	LastName               string `json:"last_name"`
	HelpTopic              string `json:"help_topic"`
	OtherDescribe          string `json:"other_describe"`
	PreferredContactMethod string `json:"preferred_contact_method"`
	BestTime               string `json:"best_time"`
	TherapistRequested     string `json:"therapist_requested"`
}

var (
	errContactFullName = errors.New("full_name must be 1–200 characters")
	errContactEmail    = errors.New("email must be valid and at most 200 characters")
	errContactPhone    = errors.New("phone must be at most 50 characters")
	errContactSubject  = errors.New("subject must be at most 200 characters")
	errContactMessage  = errors.New("message must be 1–5000 characters")
	errContactField    = errors.New("contact fields must be at most 500 characters")
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
	// The remaining discrete fields are short, free-form, and optional.
	for _, f := range []string{
		b.FirstName, b.LastName, b.HelpTopic, b.PreferredContactMethod,
		b.BestTime, b.TherapistRequested,
	} {
		if utf8.RuneCountInString(f) > 500 {
			return errContactField
		}
	}
	if utf8.RuneCountInString(b.OtherDescribe) > 5000 {
		return errContactField
	}
	return nil
}

// ContactHandler handles POST /v1/contact.
type ContactHandler struct {
	Pool *pgxpool.Pool

	// Notify is the patient-facing email outbox. When NotifyEnabled is true
	// and Notify is non-nil, a "we received your request" acknowledgement is
	// enqueued to the submitter. Best-effort — never fails the submission.
	Notify        *phi.NotificationStore
	NotifyEnabled bool
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

	// IP and user_agent removed — HIPAA minimum-necessary (§164.502(b)).
	// No documented clinical need; storing IP + health-context message = linkable PHI.
	const query = `
		INSERT INTO bt.contact_submissions
			(full_name, email, phone, subject, message, source,
			 first_name, last_name, help_topic, other_describe,
			 preferred_contact_method, best_time, therapist_requested)
		VALUES ($1,$2,$3,$4,$5,'website',$6,$7,$8,$9,$10,$11,$12)`

	if _, err := h.Pool.Exec(r.Context(), query,
		body.FullName, body.Email, nullableString(body.Phone), nullableString(body.Subject), body.Message,
		nullableString(body.FirstName), nullableString(body.LastName),
		nullableString(body.HelpTopic), nullableString(body.OtherDescribe),
		nullableString(body.PreferredContactMethod), nullableString(body.BestTime),
		nullableString(body.TherapistRequested),
	); err != nil {
		slog.Error("contact: insert", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// Best-effort acknowledgement email — never fail the submission over a
	// missed notification. Content is minimum-necessary: a greeting + "request
	// received, our team will be in touch" + callback button. No health info,
	// no read-back of what was submitted.
	if h.NotifyEnabled && h.Notify != nil {
		firstName := strings.TrimSpace(body.FirstName)
		if firstName == "" {
			// Fall back to the first token of the full name.
			if parts := strings.Fields(body.FullName); len(parts) > 0 {
				firstName = parts[0]
			}
		}
		greeting := notifyGreeting(firstName)
		subj, heading, paragraphs, details := buildContactAckContent(greeting)
		// Dedupe on email so a rapid double-submit doesn't double-send.
		dedupeKey := fmt.Sprintf("contactack:%s", strings.ToLower(strings.TrimSpace(body.Email)))
		queued := enqueueEmail(r.Context(), h.Notify, body.Email, subj, heading, paragraphs, details, false, dedupeKey, "contact")
		slog.Info("contact: ack email enqueue", "channel", "email", "enqueued", queued)
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// nullableString returns nil when s (after trimming) is empty, otherwise a
// pointer to the trimmed value.
func nullableString(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}
