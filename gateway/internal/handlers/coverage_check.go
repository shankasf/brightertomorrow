// Package handlers — public coverage-check endpoint.
//
// POST /v1/coverage/check is the hero "Check Your Coverage" form. It collects
// the minimum Claim.MD needs (first/last/dob/payer/member_id), runs a live
// eligibility probe through the AI service, and records the outcome to
// bt.insurance_checks with source="website-coverage-flow" so admins see it
// on /admin/insurance-checks alongside chatbot/voice checks.
//
// HIPAA model
// ===========
// * No IntakeRecord — this is a coverage probe, not a booking. No
//   appointment, no therapist assignment.
// * One InsuranceCheckRecord lands on DynamoDB bt-main (BAA-covered,
//   CMK-encrypted) carrying the patient PHI the visitor just typed
//   (name, DOB, payer, member ID, optional phone/email). That's the same
//   PHI surface the chatbot / voice agent persist via /internal/coverage/record.
// * Admin reads on /admin/insurance-checks are audited per row via
//   admin.LogPHIAccessBatch. §164.312(b).
package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/aiclient"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
)

// CoverageCheckHandler powers POST /v1/coverage/check.
//
// Persistence: writes the audit row directly to DynamoDB bt-main (BAA-covered).
// Postgres no longer touches insurance data per project_hostinger_not_hipaa.
type CoverageCheckHandler struct {
	PHI             *phi.Store
	CoverageChecker CoverageChecker
}

type coverageCheckRequest struct {
	FirstName   string `json:"first_name"`
	LastName    string `json:"last_name"`
	DateOfBirth string `json:"date_of_birth"` // YYYY-MM-DD
	PayerName   string `json:"payer_name"`
	MemberID    string `json:"member_id"`
	// Optional follow-up contact. Hashed into email_hash when present so a
	// later booking from the same person can be correlated.
	Email string `json:"email,omitempty"`
	Phone string `json:"phone,omitempty"`
}

type coverageCheckResponse struct {
	OK             bool   `json:"ok"`
	CheckUUID      string `json:"check_uuid"`
	Eligible       bool   `json:"eligible"`
	CoverageStatus string `json:"coverage_status"`
	Payer          string `json:"payer"`
	Plan           string `json:"plan,omitempty"`
	Copay          string `json:"copay,omitempty"`
	Message        string `json:"message"`
}

var (
	errCovFirstName = errors.New("first_name must be 1–100 characters")
	errCovLastName  = errors.New("last_name must be 1–100 characters")
	errCovDOB       = errors.New("date_of_birth must be a valid YYYY-MM-DD date")
	errCovPayer     = errors.New("payer_name must be 1–200 characters")
	errCovMember    = errors.New("member_id must be 1–100 characters")
	errCovEmail     = errors.New("email must be valid when provided")
	errCovPhone     = errors.New("phone must be at most 50 characters")
)

func (b *coverageCheckRequest) normalize() {
	b.FirstName = strings.TrimSpace(b.FirstName)
	b.LastName = strings.TrimSpace(b.LastName)
	b.DateOfBirth = strings.TrimSpace(b.DateOfBirth)
	b.PayerName = strings.TrimSpace(b.PayerName)
	b.MemberID = strings.TrimSpace(b.MemberID)
	b.Email = strings.TrimSpace(b.Email)
	b.Phone = strings.TrimSpace(b.Phone)
}

func (b *coverageCheckRequest) validate() error {
	if l := utf8.RuneCountInString(b.FirstName); l < 1 || l > 100 {
		return errCovFirstName
	}
	if l := utf8.RuneCountInString(b.LastName); l < 1 || l > 100 {
		return errCovLastName
	}
	if !validISODate(b.DateOfBirth) {
		return errCovDOB
	}
	if l := utf8.RuneCountInString(b.PayerName); l < 1 || l > 200 {
		return errCovPayer
	}
	if l := utf8.RuneCountInString(b.MemberID); l < 1 || l > 100 {
		return errCovMember
	}
	if b.Email != "" && (utf8.RuneCountInString(b.Email) > 200 || !emailRE.MatchString(b.Email)) {
		return errCovEmail
	}
	if utf8.RuneCountInString(b.Phone) > 50 {
		return errCovPhone
	}
	return nil
}

// ServeHTTP runs the eligibility probe + writes one audit row.
func (h *CoverageCheckHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body coverageCheckRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	body.normalize()
	if err := body.validate(); err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 25*time.Second)
	defer cancel()

	eligible := false
	coverageStatus := "needs_review"
	payerName := body.PayerName
	plan := ""
	copay := ""

	if h.CoverageChecker == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "coverage checker not configured")
		return
	}

	checkResp, err := h.CoverageChecker.CheckCoverage(ctx, aiclient.CoverageCheckRequest{
		PatientID: body.FirstName + "-" + body.LastName + "-" + dobCompact(body.DateOfBirth),
		FirstName: body.FirstName,
		LastName:  body.LastName,
		DOB:       dobCompact(body.DateOfBirth),
		PayerName: body.PayerName,
		MemberID:  body.MemberID,
	})
	if err != nil {
		slog.Warn("coverage_check: ai verify failed", "err", err, "payer", body.PayerName)
		coverageStatus = "verification_error"
	} else {
		eligible = checkResp.Eligible
		coverageStatus = coverageState(checkResp.Coverage)
		if coverageStatus == "" || coverageStatus == "needs_review" {
			if eligible {
				coverageStatus = "eligible"
			} else {
				coverageStatus = "needs_review"
			}
		}
		if checkResp.Payer != "" {
			payerName = checkResp.Payer
		}
		if checkResp.Coverage != nil {
			plan = stringFromMap(checkResp.Coverage, "plan")
			copay = stringFromMap(checkResp.Coverage, "copay")
		}
	}

	// Prefer email-derived hash when a contact was given so a later
	// booking from the same visitor links cleanly via email_hash. Otherwise
	// fall back to the name+DOB hash used by chat/voice standalone checks.
	var hash string
	if body.Email != "" {
		hash = phi.HashEmail(body.Email)
	} else {
		hash = patientHashFor(body.FirstName, body.LastName, body.DateOfBirth)
	}

	// Audit the public-website coverage check on DynamoDB bt-main (BAA-covered).
	checkUUID := uuid.NewString()
	now := time.Now().UTC()
	if h.PHI != nil {
		if err := h.PHI.PutInsuranceCheck(ctx, phi.InsuranceCheckRecord{
			CheckUUID:      checkUUID,
			Source:         "website-coverage-flow",
			PayerName:      payerName,
			CoverageStatus: CanonicalCoverageStatus(coverageStatus, eligible),
			Eligible:       eligible,
			EmailHash:      hash,
			FirstName:      body.FirstName,
			LastName:       body.LastName,
			DateOfBirth:    body.DateOfBirth,
			Phone:          body.Phone,
			Email:          body.Email,
			MemberID:       body.MemberID,
			CreatedAt:      now,
			RetainUntil:    now.AddDate(10, 0, 0),
		}); err != nil {
			slog.Error("coverage_check: audit insert failed",
				"err", err, "patient_hash", hash, "payer", payerName)
			// Continue — the visitor still gets a result; the audit row
			// just didn't land. Don't fail the request.
		}
	}

	slog.Info("coverage_check: recorded",
		"check_uuid", checkUUID,
		"patient_hash", hash,
		"payer", payerName,
		"eligible", eligible,
		"coverage_status", coverageStatus,
	)

	msg := messageFor(eligible, coverageStatus, payerName, copay)
	httpx.WriteJSON(w, http.StatusOK, coverageCheckResponse{
		OK:             true,
		CheckUUID:      checkUUID,
		Eligible:       eligible,
		CoverageStatus: coverageStatus,
		Payer:          payerName,
		Plan:           plan,
		Copay:          copay,
		Message:        msg,
	})
}

func stringFromMap(m map[string]any, key string) string {
	if v, ok := m[key]; ok && v != nil {
		return strings.TrimSpace(toString(v))
	}
	return ""
}

func toString(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func messageFor(eligible bool, status, payer, copay string) string {
	if eligible {
		if copay != "" {
			return "Good news — you're covered through " + payer + ". Estimated copay: $" + copay + ". Our care team will reach out within 1 business day."
		}
		return "Good news — you're covered through " + payer + ". Our care team will reach out within 1 business day."
	}
	if status == "verification_error" {
		return "We couldn't auto-verify your plan right now. Our care team will follow up within 1 business day to confirm and walk through your options."
	}
	return "We couldn't confirm active coverage with " + payer + " right now. Our care team will follow up within 1 business day to review your plan and discuss out-of-network options."
}
