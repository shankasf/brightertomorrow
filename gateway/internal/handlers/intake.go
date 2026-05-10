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

	"github.com/brightertomorrowtherapy/bt-gateway/internal/aiclient"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const (
	intakeFlowBooking  = "booking"
	intakeFlowCoverage = "coverage"

	intakePaymentInsurance = "insurance"
	intakePaymentSelfPay   = "self_pay"
)

type intakeRequest struct {
	Flow                   string `json:"flow"`
	Service                string `json:"service"`
	PaymentMethod          string `json:"payment_method"`
	FirstName              string `json:"first_name"`
	LastName               string `json:"last_name"`
	DateOfBirth            string `json:"date_of_birth"`
	Phone                  string `json:"phone"`
	Email                  string `json:"email"`
	HomeAddress            string `json:"home_address"`
	Sex                    string `json:"sex"`
	InsuranceName          string `json:"insurance_name"`
	InsuranceMemberID      string `json:"insurance_member_id"`
	SubscriberName         string `json:"subscriber_name"`
	SubscriberRelationship string `json:"subscriber_relationship"`
	Notes                  string `json:"notes"`
	// Source is only honoured on the internal endpoint; on the public
	// endpoint it is derived from Flow.
	Source string `json:"source,omitempty"`
}

type intakeResponse struct {
	OK             bool           `json:"ok"`
	SubmissionID   int64          `json:"submission_id"`
	SubmissionUUID string         `json:"submission_uuid"`
	Eligible       bool           `json:"eligible"`
	CoverageStatus string         `json:"coverage_status"`
	Coverage       map[string]any `json:"coverage"`
	NextStep       string         `json:"next_step"`
}

type intakeDB interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// phiStorer is the subset of phi.Store that the handler needs.
// Defined by the consumer (this package), not the producer.
type phiStorer interface {
	PutIntake(ctx context.Context, r phi.IntakeRecord) error
}

type CoverageChecker interface {
	CheckCoverage(ctx context.Context, in aiclient.CoverageCheckRequest) (aiclient.CoverageCheckResponse, error)
}

type IntakeHandler struct {
	Pool            intakeDB
	PHI             phiStorer
	CoverageChecker CoverageChecker
}

var (
	errIntakeFlow              = errors.New("flow must be booking or coverage")
	errIntakeService           = errors.New("service must be 1–200 characters")
	errIntakePaymentMethod     = errors.New("payment_method must be insurance or self_pay")
	errIntakePaymentCoverage   = errors.New("coverage flow requires payment_method=insurance")
	errIntakeFirstName         = errors.New("first_name must be 1–100 characters")
	errIntakeLastName          = errors.New("last_name must be 1–100 characters")
	errIntakeDOB               = errors.New("date_of_birth must be a valid YYYY-MM-DD date")
	errIntakePhone             = errors.New("phone must be 1–50 characters")
	errIntakeEmail             = errors.New("email must be valid and at most 200 characters")
	errIntakeHomeAddress       = errors.New("home_address must be 1–300 characters")
	errIntakeSex               = errors.New("sex must be 1–50 characters")
	errIntakeInsuranceName     = errors.New("insurance_name must be 1–200 characters")
	errIntakeInsuranceMemberID = errors.New("insurance_member_id must be 1–100 characters")
	errIntakeSubscriberName    = errors.New("subscriber_name must be 1–200 characters")
	errIntakeSubscriberRel     = errors.New("subscriber_relationship must be 1–50 characters")
	errIntakeNotes             = errors.New("notes must be at most 2000 characters")
)

func (b *intakeRequest) normalize() {
	b.Flow = strings.ToLower(strings.TrimSpace(b.Flow))
	b.Service = strings.TrimSpace(b.Service)
	b.PaymentMethod = strings.ToLower(strings.TrimSpace(b.PaymentMethod))
	b.FirstName = strings.TrimSpace(b.FirstName)
	b.LastName = strings.TrimSpace(b.LastName)
	b.DateOfBirth = strings.TrimSpace(b.DateOfBirth)
	b.Phone = strings.TrimSpace(b.Phone)
	b.Email = strings.TrimSpace(b.Email)
	b.HomeAddress = strings.TrimSpace(b.HomeAddress)
	b.Sex = strings.TrimSpace(b.Sex)
	b.InsuranceName = strings.TrimSpace(b.InsuranceName)
	b.InsuranceMemberID = strings.TrimSpace(b.InsuranceMemberID)
	b.SubscriberName = strings.TrimSpace(b.SubscriberName)
	b.SubscriberRelationship = strings.TrimSpace(b.SubscriberRelationship)
	b.Notes = strings.TrimSpace(b.Notes)
}

func (b *intakeRequest) validate() error {
	if b.Flow != intakeFlowBooking && b.Flow != intakeFlowCoverage {
		return errIntakeFlow
	}
	if l := utf8.RuneCountInString(b.Service); l < 1 || l > 200 {
		return errIntakeService
	}
	if b.PaymentMethod != intakePaymentInsurance && b.PaymentMethod != intakePaymentSelfPay {
		return errIntakePaymentMethod
	}
	if b.Flow == intakeFlowCoverage && b.PaymentMethod != intakePaymentInsurance {
		return errIntakePaymentCoverage
	}
	if l := utf8.RuneCountInString(b.FirstName); l < 1 || l > 100 {
		return errIntakeFirstName
	}
	if l := utf8.RuneCountInString(b.LastName); l < 1 || l > 100 {
		return errIntakeLastName
	}
	if !validISODate(b.DateOfBirth) {
		return errIntakeDOB
	}
	if l := utf8.RuneCountInString(b.Phone); l < 1 || l > 50 {
		return errIntakePhone
	}
	if l := utf8.RuneCountInString(b.Email); l < 1 || l > 200 || !emailRE.MatchString(b.Email) {
		return errIntakeEmail
	}
	if l := utf8.RuneCountInString(b.HomeAddress); l < 1 || l > 300 {
		return errIntakeHomeAddress
	}
	if l := utf8.RuneCountInString(b.Sex); l < 1 || l > 50 {
		return errIntakeSex
	}
	if utf8.RuneCountInString(b.Notes) > 2000 {
		return errIntakeNotes
	}

	if b.PaymentMethod == intakePaymentInsurance {
		if l := utf8.RuneCountInString(b.InsuranceName); l < 1 || l > 200 {
			return errIntakeInsuranceName
		}
		if l := utf8.RuneCountInString(b.InsuranceMemberID); l < 1 || l > 100 {
			return errIntakeInsuranceMemberID
		}
		if l := utf8.RuneCountInString(b.SubscriberName); l < 1 || l > 200 {
			return errIntakeSubscriberName
		}
		if l := utf8.RuneCountInString(b.SubscriberRelationship); l < 1 || l > 50 {
			return errIntakeSubscriberRel
		}
	}

	return nil
}

func validISODate(value string) bool {
	dob, err := time.Parse("2006-01-02", value)
	if err != nil {
		return false
	}
	now := time.Now().UTC()
	if dob.After(now) {
		return false
	}
	return dob.Year() >= 1900 && dob.Year() <= now.Year()
}

func dobCompact(value string) string {
	return strings.ReplaceAll(value, "-", "")
}

func (h *IntakeHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
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

	// Public endpoint: source is always derived from flow.
	body.Source = intakeSource(body.Flow)

	resp, status, err := h.submit(r.Context(), body)
	if err != nil {
		httpx.WriteError(w, status, err.Error())
		return
	}
	httpx.WriteJSON(w, status, resp)
}

// submit is the shared core used by both the public IntakeHandler and the
// internal IntakeInternalHandler. Source must be set on body before calling.
func (h *IntakeHandler) submit(ctx context.Context, body intakeRequest) (intakeResponse, int, error) {
	coverage := map[string]any{
		"status": "self_pay",
		"plan":   "Self-pay / Out-of-network",
	}
	coverageStatus := "self_pay"
	eligible := false
	payerName := body.InsuranceName

	if body.PaymentMethod == intakePaymentInsurance {
		if h.CoverageChecker == nil {
			return intakeResponse{}, http.StatusInternalServerError, fmt.Errorf("internal server error")
		}

		checkResp, err := h.CoverageChecker.CheckCoverage(ctx, aiclient.CoverageCheckRequest{
			PatientID: body.Email,
			FirstName: body.FirstName,
			LastName:  body.LastName,
			DOB:       dobCompact(body.DateOfBirth),
			PayerName: body.InsuranceName,
			MemberID:  body.InsuranceMemberID,
		})
		if err != nil {
			slog.Warn("intake: coverage verification failed", "err", err, "flow", body.Flow, "email", body.Email)
			coverage = map[string]any{
				"status": "verification_error",
				"plan":   payerName,
			}
			coverageStatus = "verification_error"
		} else {
			coverage = checkResp.Coverage
			coverageStatus = coverageState(checkResp.Coverage)
			eligible = checkResp.Eligible
			if checkResp.Payer != "" {
				payerName = checkResp.Payer
			}
		}

	}

	submissionUUID := uuid.NewString()
	emailHash := phi.HashEmail(body.Email)
	now := time.Now().UTC()

	// Normalise coverage map for DDB storage (map[string]string).
	coverageDDB := make(map[string]string, len(coverage))
	for k, v := range coverage {
		coverageDDB[k] = cleanValue(v)
	}

	rec := phi.IntakeRecord{
		SubmissionUUID:         submissionUUID,
		EmailHash:              emailHash,
		Flow:                   body.Flow,
		Service:                body.Service,
		PaymentMethod:          body.PaymentMethod,
		Source:                 body.Source,
		FirstName:              body.FirstName,
		LastName:               body.LastName,
		DateOfBirth:            body.DateOfBirth,
		Phone:                  body.Phone,
		Email:                  body.Email,
		HomeAddress:            body.HomeAddress,
		Sex:                    body.Sex,
		InsuranceName:          body.InsuranceName,
		InsuranceMemberID:      body.InsuranceMemberID,
		SubscriberName:         body.SubscriberName,
		SubscriberRelationship: body.SubscriberRelationship,
		Notes:                  body.Notes,
		CoverageStatus:         coverageStatus,
		Eligible:               eligible,
		Coverage:               coverageDDB,
		CreatedAt:              now,
		RetainUntil:            now.AddDate(10, 0, 0),
	}

	// Fail-closed: if DynamoDB is unavailable, we do NOT accept the intake.
	if h.PHI != nil {
		if err := h.PHI.PutIntake(ctx, rec); err != nil {
			slog.Error("intake: phi store put failed",
				"err", err,
				"flow", body.Flow,
				"submission_uuid", submissionUUID,
			)
			return intakeResponse{}, http.StatusServiceUnavailable, fmt.Errorf("phi_store_unavailable")
		}
	}

	// Insert non-PHI pointer into Postgres. If this fails after Dynamo
	// succeeded, log for operator remediation but return 200 — Dynamo is
	// the source of truth.
	var submissionID int64
	if h.Pool != nil {
		ddbPK := "PATIENT#" + emailHash
		ddbSK := "INTAKE#" + submissionUUID
		row := h.Pool.QueryRow(ctx, `
			INSERT INTO bt.intake_pointers
				(submission_uuid, email_hash, flow, payment_method, status, source, ddb_pk, ddb_sk)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			RETURNING id
		`, submissionUUID, emailHash, body.Flow, body.PaymentMethod, coverageStatus, body.Source, ddbPK, ddbSK)
		if err := row.Scan(&submissionID); err != nil {
			slog.Error("intake: pointer insert failed — DynamoDB record exists, manual reconciliation required",
				"err", err,
				"submission_uuid", submissionUUID,
				"email_hash", emailHash,
			)
			// Return 200 — Dynamo is source of truth.
		}

		// Record the eligibility-check attempt in bt.insurance_checks so admins
		// can review the full history of CLAIM.MD verifications (including
		// checks that don't lead to a completed booking). Non-PHI columns
		// only — name + member ID stay in DynamoDB. §164.312(b)
		if body.PaymentMethod == intakePaymentInsurance {
			_, ierr := h.Pool.Exec(ctx, `
				INSERT INTO bt.insurance_checks
					(submission_uuid, source, payer_name, coverage_status, eligible, email_hash)
				VALUES ($1, $2, $3, $4, $5, $6)
			`, submissionUUID, body.Source, payerName, coverageStatus, eligible, emailHash)
			if ierr != nil {
				slog.Warn("intake: insurance_checks insert failed",
					"err", ierr, "source", body.Source, "payer", payerName)
				// Don't fail the request — the eligibility decision still stands.
			}
		}
	}

	return intakeResponse{
		OK:             true,
		SubmissionID:   submissionID,
		SubmissionUUID: submissionUUID,
		Eligible:       eligible,
		CoverageStatus: coverageStatus,
		Coverage:       coverage,
		NextStep:       intakeNextStep(body.Flow, body.PaymentMethod, coverageStatus, eligible),
	}, http.StatusOK, nil
}

func coverageState(coverage map[string]any) string {
	if coverage == nil {
		return "needs_review"
	}
	status := strings.TrimSpace(fmt.Sprint(coverage["status"]))
	if status == "" || status == "<nil>" {
		return "needs_review"
	}
	return status
}

func intakeSource(flow string) string {
	if flow == intakeFlowCoverage {
		return "website-coverage-flow"
	}
	return "website-booking-flow"
}

func intakeNextStep(flow, paymentMethod, coverageStatus string, eligible bool) string {
	if flow == intakeFlowCoverage {
		if eligible {
			return "We checked your coverage and our care team will contact you within 1 business day to confirm next steps."
		}
		return "Our care team will contact you within 1 business day to review your coverage details and talk through next steps."
	}

	if paymentMethod == intakePaymentSelfPay {
		return "Our care team will contact you within 1 business day to review self-pay options and schedule your first appointment."
	}
	if eligible {
		return "Your coverage has been checked, and our care team will contact you within 1 business day to schedule your first appointment."
	}
	if coverageStatus == "verification_error" {
		return "Our care team will contact you within 1 business day to review your insurance details and schedule your first appointment."
	}
	return "Our care team will contact you within 1 business day to review your coverage options and schedule your first appointment."
}

func cleanValue(v any) string {
	s := strings.TrimSpace(fmt.Sprint(v))
	if s == "" || s == "<nil>" {
		return ""
	}
	return s
}

func yesNo(v bool) string {
	if v {
		return "Yes"
	}
	return "No"
}
