package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/aiclient"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	pgxmock "github.com/pashagolub/pgxmock/v3"
)

type stubCoverageChecker struct {
	lastRequest aiclient.CoverageCheckRequest
	response    aiclient.CoverageCheckResponse
	err         error
}

func (s *stubCoverageChecker) CheckCoverage(_ context.Context, in aiclient.CoverageCheckRequest) (aiclient.CoverageCheckResponse, error) {
	s.lastRequest = in
	return s.response, s.err
}

// stubPHIStore is a no-op phi store used in tests so we don't need real DynamoDB.
type stubPHIStore struct {
	putErr        error
	smsConsentErr error
}

func (s *stubPHIStore) PutIntake(_ context.Context, _ phi.IntakeRecord) error {
	return s.putErr
}

func (s *stubPHIStore) PutInsuranceCheck(_ context.Context, _ phi.InsuranceCheckRecord) error {
	return nil
}

func (s *stubPHIStore) FindStandaloneCheckForReuse(_ context.Context, _, _ string, _ time.Duration) (*phi.InsuranceReuse, error) {
	return nil, phi.ErrNotFound
}

func (s *stubPHIStore) LinkCheckToSubmission(_ context.Context, _, _, _, _ string) error {
	return nil
}

func (s *stubPHIStore) PutSMSConsent(_ context.Context, _ phi.SMSConsentInput) error {
	return s.smsConsentErr
}

func TestIntakeRequestValidate(t *testing.T) {
	valid := intakeRequest{
		Flow:                   intakeFlowBooking,
		Service:                "Individual Therapy",
		PaymentMethod:          intakePaymentInsurance,
		FirstName:              "Alice",
		LastName:               "Doe",
		DateOfBirth:            "1990-05-10",
		Phone:                  "702-555-0100",
		Email:                  "alice@example.com",
		HomeAddress:            "123 Main St, Las Vegas, NV 89101",
		Sex:                    "Female",
		InsuranceName:          "Aetna",
		InsuranceMemberID:      "A1234567",
		SubscriberName:         "Alice Doe",
		SubscriberRelationship: "Self",
	}

	tests := []struct {
		name    string
		req     intakeRequest
		wantErr error
	}{
		{name: "valid insurance booking", req: valid, wantErr: nil},
		{
			name: "valid self pay booking",
			req: func() intakeRequest {
				r := valid
				r.PaymentMethod = intakePaymentSelfPay
				r.InsuranceName = ""
				r.InsuranceMemberID = ""
				r.SubscriberName = ""
				r.SubscriberRelationship = ""
				return r
			}(),
			wantErr: nil,
		},
		{
			name: "coverage requires insurance payment method",
			req: func() intakeRequest {
				r := valid
				r.Flow = intakeFlowCoverage
				r.PaymentMethod = intakePaymentSelfPay
				return r
			}(),
			wantErr: errIntakePaymentCoverage,
		},
		{
			name: "insurance booking missing member id",
			req: func() intakeRequest {
				r := valid
				r.InsuranceMemberID = ""
				return r
			}(),
			wantErr: errIntakeInsuranceMemberID,
		},
		{
			name: "invalid dob",
			req: func() intakeRequest {
				r := valid
				r.DateOfBirth = "1990/05/10"
				return r
			}(),
			wantErr: errIntakeDOB,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.req.validate()
			if err != tc.wantErr {
				t.Errorf("validate() = %v, want %v", err, tc.wantErr)
			}
		})
	}
}

func TestIntakeHandlerInsuranceBooking(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	checker := &stubCoverageChecker{
		response: aiclient.CoverageCheckResponse{
			OK:       true,
			Payer:    "Aetna",
			Eligible: true,
			Coverage: map[string]any{"status": "active", "plan": "Gold PPO", "copay": "$25"},
		},
	}

	body := `{
		"flow":"booking",
		"service":"Individual Therapy",
		"payment_method":"insurance",
		"first_name":"Alice",
		"last_name":"Doe",
		"date_of_birth":"1990-05-10",
		"phone":"702-555-0100",
		"email":"alice@example.com",
		"home_address":"123 Main St, Las Vegas, NV 89101",
		"sex":"Female",
		"insurance_name":"Aetna",
		"insurance_member_id":"A1234567",
		"subscriber_name":"Alice Doe",
		"subscriber_relationship":"Self"
	}`

	r := httptest.NewRequest(http.MethodPost, "/v1/intake", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h := &IntakeHandler{Pool: mock, PHI: &stubPHIStore{}, CoverageChecker: checker}
	h.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	if checker.lastRequest.DOB != "19900510" {
		t.Errorf("expected DOB compacted to 19900510, got %q", checker.lastRequest.DOB)
	}

	var resp struct {
		OK             bool   `json:"ok"`
		SubmissionUUID string `json:"submission_uuid"`
		CoverageStatus string `json:"coverage_status"`
		NextStep       string `json:"next_step"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !resp.OK {
		t.Error("expected ok=true")
	}
	if resp.CoverageStatus != "active" {
		t.Errorf("expected coverage_status=active, got %q", resp.CoverageStatus)
	}
	if resp.SubmissionUUID == "" {
		t.Error("expected non-empty submission_uuid")
	}
	if !strings.Contains(resp.NextStep, "1 business day") {
		t.Errorf("expected next_step to mention turnaround, got %q", resp.NextStep)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled mock expectations: %v", err)
	}
}

func TestIntakeHandlerSelfPayBooking(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}

	body := `{
		"flow":"booking",
		"service":"Couples Therapy",
		"payment_method":"self_pay",
		"first_name":"Jamie",
		"last_name":"Doe",
		"date_of_birth":"1988-02-14",
		"phone":"702-555-0101",
		"email":"jamie@example.com",
		"home_address":"456 Oak Ave, Las Vegas, NV 89102",
		"sex":"Male",
		"notes":"Prefers evening availability"
	}`

	r := httptest.NewRequest(http.MethodPost, "/v1/intake", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h := &IntakeHandler{Pool: mock, PHI: &stubPHIStore{}}
	h.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled mock expectations: %v", err)
	}
}

func TestIntakeHandlerPHIStoreFailure(t *testing.T) {
	mock, err := pgxmock.NewPool()
	if err != nil {
		t.Fatalf("pgxmock.NewPool: %v", err)
	}
	// No DB expectations — pool should NOT be called if PHI store fails.

	body := `{
		"flow":"booking",
		"service":"Individual Therapy",
		"payment_method":"self_pay",
		"first_name":"Test",
		"last_name":"User",
		"date_of_birth":"1990-01-15",
		"phone":"702-555-0199",
		"email":"test@example.com",
		"home_address":"789 Pine Rd, Las Vegas, NV 89103",
		"sex":"Other"
	}`

	r := httptest.NewRequest(http.MethodPost, "/v1/intake", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()

	h := &IntakeHandler{
		Pool: mock,
		PHI:  &stubPHIStore{putErr: phi.ErrAlreadyExists},
	}
	h.ServeHTTP(w, r)

	if w.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503 on PHI store failure, got %d: %s", w.Code, w.Body.String())
	}
	// Pool should not have been called.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unexpected DB call: %v", err)
	}
}
