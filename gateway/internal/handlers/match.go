// Package handlers — public "Get matched" lead intake.
//
// POST /v1/match is the hero "Get Started" form. It's a lightweight
// intake that captures the bare minimum we need to route a lead to a
// therapist (name, DOB, contact, preferences) — no payment method, no
// insurance verification, no Claim.MD call. The resulting row shows up
// on /admin/appointments under source="website-match-flow" so the care
// team can pick it up the same way as a full booking.
//
// HIPAA model
// ===========
// * PHI lives in DynamoDB (bt-main, CMK-encrypted). Postgres only sees
//   the non-PHI pointer (submission_uuid, email_hash, source, flow).
// * No Claim.MD call from this path — match leads opt in to eligibility
//   verification later, when they actually book.
// * Fail-closed on DDB write; we don't accept the intake if PHI storage
//   isn't durable.
package handlers

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	matchFlow   = "match"
	matchSource = "website-match-flow"
)

// MatchHandler powers POST /v1/match.
type MatchHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store
}

type matchRequest struct {
	FirstName   string   `json:"first_name"`
	LastName    string   `json:"last_name"`
	DateOfBirth string   `json:"date_of_birth"` // YYYY-MM-DD
	Email       string   `json:"email"`
	Phone       string   `json:"phone"`
	Audience    string   `json:"audience"` // me | couple | child | family
	Focus       []string `json:"focus"`
	Modality    string   `json:"modality"` // in-person | telehealth | either
	Notes       string   `json:"notes"`
}

type matchResponse struct {
	OK             bool   `json:"ok"`
	SubmissionUUID string `json:"submission_uuid"`
	Message        string `json:"message"`
}

var (
	errMatchFirstName = errors.New("first_name must be 1–100 characters")
	errMatchLastName  = errors.New("last_name must be 1–100 characters")
	errMatchDOB       = errors.New("date_of_birth must be a valid YYYY-MM-DD date")
	errMatchEmail     = errors.New("email must be a valid email address")
	errMatchPhone     = errors.New("phone must be 1–50 characters")
	errMatchAudience  = errors.New("audience must be me, couple, child, or family")
	errMatchFocus     = errors.New("focus must be 1–10 selections, each ≤ 80 chars")
	errMatchModality  = errors.New("modality must be in-person, telehealth, or either")
	errMatchNotes     = errors.New("notes must be ≤ 2000 characters")
)

var (
	matchAllowedAudience = map[string]struct{}{
		"me": {}, "couple": {}, "child": {}, "family": {},
	}
	matchAllowedModality = map[string]struct{}{
		"in-person": {}, "telehealth": {}, "either": {},
	}
)

func (b *matchRequest) normalize() {
	b.FirstName = strings.TrimSpace(b.FirstName)
	b.LastName = strings.TrimSpace(b.LastName)
	b.DateOfBirth = strings.TrimSpace(b.DateOfBirth)
	b.Email = strings.TrimSpace(b.Email)
	b.Phone = strings.TrimSpace(b.Phone)
	b.Audience = strings.ToLower(strings.TrimSpace(b.Audience))
	b.Modality = strings.ToLower(strings.TrimSpace(b.Modality))
	b.Notes = strings.TrimSpace(b.Notes)
	clean := make([]string, 0, len(b.Focus))
	for _, f := range b.Focus {
		f = strings.TrimSpace(f)
		if f != "" {
			clean = append(clean, f)
		}
	}
	b.Focus = clean
}

func (b *matchRequest) validate() error {
	if l := utf8.RuneCountInString(b.FirstName); l < 1 || l > 100 {
		return errMatchFirstName
	}
	if l := utf8.RuneCountInString(b.LastName); l < 1 || l > 100 {
		return errMatchLastName
	}
	if !validISODate(b.DateOfBirth) {
		return errMatchDOB
	}
	if l := utf8.RuneCountInString(b.Email); l < 1 || l > 200 || !emailRE.MatchString(b.Email) {
		return errMatchEmail
	}
	if l := utf8.RuneCountInString(b.Phone); l < 1 || l > 50 {
		return errMatchPhone
	}
	if _, ok := matchAllowedAudience[b.Audience]; !ok {
		return errMatchAudience
	}
	if _, ok := matchAllowedModality[b.Modality]; !ok {
		return errMatchModality
	}
	if len(b.Focus) < 1 || len(b.Focus) > 10 {
		return errMatchFocus
	}
	for _, f := range b.Focus {
		if utf8.RuneCountInString(f) > 80 {
			return errMatchFocus
		}
	}
	if utf8.RuneCountInString(b.Notes) > 2000 {
		return errMatchNotes
	}
	return nil
}

// matchService composes a one-line "service" summary for the intake record
// from the visitor's structured answers. Shows up as the appointment's
// service column on /admin/appointments.
func matchService(b *matchRequest) string {
	parts := []string{"Therapist match"}
	switch b.Audience {
	case "me":
		parts = append(parts, "for self")
	case "couple":
		parts = append(parts, "for couple")
	case "child":
		parts = append(parts, "for child / teen")
	case "family":
		parts = append(parts, "for family")
	}
	switch b.Modality {
	case "in-person":
		parts = append(parts, "in-person")
	case "telehealth":
		parts = append(parts, "telehealth")
	case "either":
		parts = append(parts, "any modality")
	}
	return strings.Join(parts, " · ")
}

// ServeHTTP creates the intake record + pointer row. The flow mirrors
// IntakeHandler.ServeHTTP minus the Claim.MD branch.
func (h *MatchHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body matchRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	body.normalize()
	if err := body.validate(); err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}

	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()

	submissionUUID := uuid.NewString()
	emailHash := phi.HashEmail(body.Email)
	now := time.Now().UTC()

	notesBits := []string{
		fmt.Sprintf("Audience: %s", body.Audience),
		fmt.Sprintf("Focus: %s", strings.Join(body.Focus, ", ")),
		fmt.Sprintf("Modality: %s", body.Modality),
	}
	if body.Notes != "" {
		notesBits = append(notesBits, "Notes: "+body.Notes)
	}
	composedNotes := strings.Join(notesBits, " | ")

	rec := phi.IntakeRecord{
		SubmissionUUID: submissionUUID,
		EmailHash:      emailHash,
		Flow:           matchFlow,
		Service:        matchService(&body),
		PaymentMethod:  "", // not collected on match flow
		Source:         matchSource,
		FirstName:      body.FirstName,
		LastName:       body.LastName,
		DateOfBirth:    body.DateOfBirth,
		Phone:          body.Phone,
		Email:          body.Email,
		Notes:          composedNotes,
		CoverageStatus: "needs_review",
		Eligible:       false,
		CreatedAt:      now,
		RetainUntil:    now.AddDate(10, 0, 0),
	}

	// PHI lands in DynamoDB only — the Hostinger Postgres is not BAA-covered.
	// IntakeRecord is the source of truth; admin Appointments page reads
	// from DDB directly via phi.ListIntakePointers.
	if err := h.PHI.PutIntake(ctx, rec); err != nil {
		slog.Error("match: phi store put failed",
			"err", err, "submission_uuid", submissionUUID)
		httpx.WriteError(w, http.StatusServiceUnavailable, "phi_store_unavailable")
		return
	}

	slog.Info("match: lead recorded",
		"submission_uuid", submissionUUID,
		"email_hash", emailHash,
		"source", matchSource,
		"audience", body.Audience,
		"modality", body.Modality,
	)

	httpx.WriteJSON(w, http.StatusOK, matchResponse{
		OK:             true,
		SubmissionUUID: submissionUUID,
		Message:        "Match request received. Our care team will reach out within one business day.",
	})
}
