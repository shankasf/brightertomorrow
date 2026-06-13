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
	PutInsuranceCheck(ctx context.Context, r phi.InsuranceCheckRecord) error
	FindStandaloneCheckForReuse(ctx context.Context, emailHash, payerName string, within time.Duration) (*phi.InsuranceReuse, error)
	LinkCheckToSubmission(ctx context.Context, checkUUID, oldEmailHash, submissionUUID, newEmailHash string) error
}

type CoverageChecker interface {
	CheckCoverage(ctx context.Context, in aiclient.CoverageCheckRequest) (aiclient.CoverageCheckResponse, error)
}

type IntakeHandler struct {
	Pool            intakeDB
	PHI             phiStorer
	CoverageChecker CoverageChecker
	Notify          *phi.NotificationStore // optional; nil → notifications silently skipped
	NotifyEnabled   bool                   // gates enqueue; default false (BT_APPOINTMENT_NOTIFY_ENABLED)
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

	// Best-effort ACK email — never fail the request over a missed notification.
	// No PHI in logs: only submission_uuid, channel, and enqueued bool.
	// No coverage/insurance info is included in the ack email.
	if h.NotifyEnabled && h.Notify != nil && strings.TrimSpace(body.Email) != "" {
		greeting := notifyGreeting(strings.TrimSpace(body.FirstName))
		subj, heading, paragraphs, details := buildRequestAckContent(greeting)
		dedupeKey := fmt.Sprintf("intakeack:%s:email", resp.SubmissionUUID)
		enqueued := enqueueEmail(r.Context(), h.Notify, strings.TrimSpace(body.Email),
			subj, heading, paragraphs, details, false, dedupeKey, resp.SubmissionUUID)
		slog.Info("intake: ACK email enqueue",
			"submission_uuid", resp.SubmissionUUID, "channel", "email", "enqueued", enqueued)
		if enqueued {
			resp.NextStep = resp.NextStep + " " + notifyEmailSentLine
		}
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

	// reusedCheckUUID identifies a standalone bt-main insurance check
	// (written by verify_coverage) that we'll re-link to this booking's
	// submission_uuid below. Empty string means "no match; ran a fresh
	// CLAIM.MD call". Mirrors the pre-DDB Postgres reuse logic but reads
	// from DynamoDB so the Hostinger VPS never sees insurance PHI.
	var (
		reusedCheckUUID      string
		reusedCheckEmailHash string
	)

	if body.PaymentMethod == intakePaymentInsurance {
		// Same-session reuse — chatbot / voice booking flow. The
		// Insurance Check agent has ALREADY run verify_coverage in this
		// conversation and written a standalone InsuranceCheckRecord
		// keyed by sha256(name+DOB). Reuse it instead of re-billing
		// CLAIM.MD seconds later for the same patient + payer.
		if body.Source == "chat-agent" || body.Source == "voice-agent" || body.Source == "voice-phone" {
			nameDOBHash := patientHashFor(body.FirstName, body.LastName, body.DateOfBirth)
			if h.PHI != nil {
				reuse, lookupErr := h.PHI.FindStandaloneCheckForReuse(ctx, nameDOBHash, body.InsuranceName, 30*time.Minute)
				switch {
				case lookupErr == nil:
					reusedCheckUUID = reuse.CheckUUID
					reusedCheckEmailHash = nameDOBHash
					eligible = reuse.Eligible
					// reuse.CoverageStatus is canonical ("verified"/etc.); IntakeRecord
					// needs the intake bucket so the row indexes under a GSI1 partition
					// that ListIntakePointers actually queries.
					coverageStatus = IntakeBucketFromCanonical(reuse.CoverageStatus, reuse.Eligible)
					coverage = map[string]any{
						"status": coverageStatus,
						"plan":   body.InsuranceName,
						"source": "in_session_verification",
					}
					slog.Info("intake: reused in-session insurance verification",
						"patient_hash", nameDOBHash,
						"check_uuid", reuse.CheckUUID,
						"source", body.Source,
					)
				case errors.Is(lookupErr, phi.ErrNotFound):
					// No prior in-session check; fall through to CoverageChecker.
				default:
					slog.Warn("intake: in-session insurance lookup failed",
						"err", lookupErr,
						"patient_hash", nameDOBHash,
						"source", body.Source,
					)
				}
			}
		}

		if reusedCheckUUID == "" {
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

	// Intake pointer + insurance_checks audit rows now live in DynamoDB
	// (bt-main). Postgres no longer holds these — the Hostinger VPS is not
	// BAA-covered. submissionID is no longer a pg serial; we return 0 to
	// preserve the response shape and rely on submissionUUID downstream.
	submissionID := int64(0)

	// Insurance audit on DDB. Two branches, never both:
	//   • Reuse: standalone check from verify_coverage exists — link it
	//     to this booking via LinkCheckToSubmission.
	//   • Fresh: no usable standalone — write a new InsuranceCheckRecord
	//     tied to this submission.
	// Self-pay skips both.
	if body.PaymentMethod == intakePaymentInsurance && h.PHI != nil {
		canonicalStatus := CanonicalCoverageStatus(coverageStatus, eligible)
		if reusedCheckUUID != "" {
			err := h.PHI.LinkCheckToSubmission(ctx,
				reusedCheckUUID, reusedCheckEmailHash, submissionUUID, emailHash)
			if err != nil {
				slog.Warn("intake: insurance check link failed",
					"err", err, "check_uuid", reusedCheckUUID,
					"submission_uuid", submissionUUID)
				// Fall back to a fresh insert so the booking still has an
				// audit row on the admin Insurance Checks page.
				_ = h.PHI.PutInsuranceCheck(ctx, phi.InsuranceCheckRecord{
					CheckUUID:      uuid.NewString(),
					SubmissionUUID: submissionUUID,
					Source:         body.Source,
					PayerName:      payerName,
					CoverageStatus: canonicalStatus,
					Eligible:       eligible,
					EmailHash:      emailHash,
					FirstName:      body.FirstName,
					LastName:       body.LastName,
					DateOfBirth:    body.DateOfBirth,
					Phone:          body.Phone,
					Email:          body.Email,
					MemberID:       body.InsuranceMemberID,
					CreatedAt:      now,
					RetainUntil:    now.AddDate(10, 0, 0),
				})
			}
		} else {
			if perr := h.PHI.PutInsuranceCheck(ctx, phi.InsuranceCheckRecord{
				CheckUUID:      uuid.NewString(),
				SubmissionUUID: submissionUUID,
				Source:         body.Source,
				PayerName:      payerName,
				CoverageStatus: canonicalStatus,
				Eligible:       eligible,
				EmailHash:      emailHash,
				FirstName:      body.FirstName,
				LastName:       body.LastName,
				DateOfBirth:    body.DateOfBirth,
				Phone:          body.Phone,
				Email:          body.Email,
				MemberID:       body.InsuranceMemberID,
				CreatedAt:      now,
				RetainUntil:    now.AddDate(10, 0, 0),
			}); perr != nil {
				slog.Warn("intake: insurance_checks insert failed",
					"err", perr, "source", body.Source, "payer", payerName)
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
