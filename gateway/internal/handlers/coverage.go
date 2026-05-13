// Package handlers — standalone coverage-check audit logger.
//
// Purpose
// =======
// When the chatbot / voice agent runs `verify_coverage` against CLAIM.MD,
// we record one row in bt.insurance_checks (Postgres) so the result shows
// up on the admin /admin/insurance-checks page alongside bookings that
// already trigger this insert from intake.go.
//
// We DO NOT cache the result and we DO NOT reuse it on later calls —
// CLAIM.MD is always re-hit. This file is purely an audit / history log.
//
// HIPAA model
// ===========
// • bt.insurance_checks holds non-PHI only — payer name, status, eligible
//   flag, email_hash (or name+DOB hash for standalone checks), source.
//   No first/last name, no DOB, no member_id ever lands in Postgres here.
//   §164.502(b) minimum necessary.
// • The row gains an immutable audit entry via the phi_audit_trigger
//   already attached to this table.
// • Endpoint is /internal/* — not exposed via Traefik ingress. Cluster
//   boundary IS the auth boundary.
package handlers

import (
	"crypto/sha256"
	"encoding/hex"
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

// CoverageInternalHandler appends one InsuranceCheckRecord per call to DynamoDB
// (bt-main). Postgres no longer holds these — the Hostinger VPS is not BAA-covered.
type CoverageInternalHandler struct {
	PHI *phi.Store
}

// recordRequest is the body of POST /internal/coverage/record. The AI
// pod sends the CLAIM.MD outcome plus enough identity bits to hash a
// stable patient identifier — never plaintext PII (we don't want first
// name, last name, or DOB leaving the DDB layer).
type recordRequest struct {
	FirstName      string `json:"first_name"`
	LastName       string `json:"last_name"`
	DateOfBirth    string `json:"date_of_birth"`     // YYYY-MM-DD
	PayerName      string `json:"payer_name"`
	PayerID        string `json:"payer_id,omitempty"` // CLAIM.MD code
	Eligible       bool   `json:"eligible"`
	CoverageStatus string `json:"coverage_status"`
	Source         string `json:"source"`             // chat-agent | voice-agent
}

func (b *recordRequest) normalize() {
	b.FirstName = strings.TrimSpace(b.FirstName)
	b.LastName = strings.TrimSpace(b.LastName)
	b.DateOfBirth = strings.TrimSpace(b.DateOfBirth)
	b.PayerName = strings.TrimSpace(b.PayerName)
	b.PayerID = strings.TrimSpace(b.PayerID)
	b.CoverageStatus = strings.TrimSpace(b.CoverageStatus)
	b.Source = strings.TrimSpace(b.Source)
}

func (b *recordRequest) validate() error {
	if l := utf8.RuneCountInString(b.FirstName); l < 1 || l > 100 {
		return errors.New("first_name must be 1–100 chars")
	}
	if l := utf8.RuneCountInString(b.LastName); l < 1 || l > 100 {
		return errors.New("last_name must be 1–100 chars")
	}
	if !validISODate(b.DateOfBirth) {
		return errors.New("date_of_birth must be YYYY-MM-DD")
	}
	if l := utf8.RuneCountInString(b.CoverageStatus); l < 1 || l > 50 {
		return errors.New("coverage_status required")
	}
	if b.Source == "" {
		return errors.New("source required")
	}
	return nil
}

// patientHashFor returns sha256 of (lower(first) | lower(last) | dob).
// Stable identifier for standalone coverage checks where we don't yet
// have the visitor's email. Same shape as phi.HashEmail (64-hex sha256)
// so the email_hash column on bt.insurance_checks accepts it.
func patientHashFor(first, last, dob string) string {
	norm := strings.ToLower(strings.TrimSpace(first)) + "|" +
		strings.ToLower(strings.TrimSpace(last)) + "|" +
		strings.TrimSpace(dob)
	sum := sha256.Sum256([]byte(norm))
	return hex.EncodeToString(sum[:])
}

// Record handles POST /internal/coverage/record.
//
// Writes one InsuranceCheckRecord to DynamoDB bt-main with SubmissionUUID
// empty (standalone — no booking yet). The chatbot / voice booking flow
// will later link this row to a submission via LinkCheckToSubmission.
func (h *CoverageInternalHandler) Record(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}

	var body recordRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	body.normalize()
	if err := body.validate(); err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}

	hash := patientHashFor(body.FirstName, body.LastName, body.DateOfBirth)
	checkUUID := uuid.NewString()
	now := time.Now().UTC()

	rec := phi.InsuranceCheckRecord{
		CheckUUID:      checkUUID,
		Source:         body.Source,
		PayerName:      body.PayerName,
		PayerID:        body.PayerID,
		CoverageStatus: CanonicalCoverageStatus(body.CoverageStatus, body.Eligible),
		Eligible:       body.Eligible,
		EmailHash:      hash,
		CreatedAt:      now,
		RetainUntil:    now.AddDate(10, 0, 0),
	}
	if err := h.PHI.PutInsuranceCheck(r.Context(), rec); err != nil {
		slog.Error("coverage record insert failed",
			"err", err, "patient_hash", hash, "source", body.Source)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	slog.Info("coverage check recorded",
		"check_uuid", checkUUID,
		"patient_hash", hash,
		"payer", body.PayerName,
		"eligible", body.Eligible,
		"coverage_status", body.CoverageStatus,
		"source", body.Source,
	)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"check_uuid": checkUUID,
	})
}
