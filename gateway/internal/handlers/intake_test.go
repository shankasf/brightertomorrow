package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/aiclient"
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

	mock.ExpectQuery(`INSERT INTO bt\.contact_submissions`).
		WithArgs(
			"Alice Doe",
			"alice@example.com",
			"702-555-0100",
			"Appointment Request (Insurance Verified)",
			pgxmock.AnyArg(),
			"website-booking-flow",
		).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(int64(42)))

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

	h := &IntakeHandler{Pool: mock, CoverageChecker: checker}
	h.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	if checker.lastRequest.DOB != "19900510" {
		t.Errorf("expected DOB compacted to 19900510, got %q", checker.lastRequest.DOB)
	}

	var resp struct {
		OK             bool   `json:"ok"`
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

	mock.ExpectQuery(`INSERT INTO bt\.contact_submissions`).
		WithArgs(
			"Jamie Doe",
			"jamie@example.com",
			"702-555-0101",
			"Appointment Request (Self-Pay)",
			pgxmock.AnyArg(),
			"website-booking-flow",
		).
		WillReturnRows(pgxmock.NewRows([]string{"id"}).AddRow(int64(43)))

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

	h := &IntakeHandler{Pool: mock}
	h.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Errorf("unfulfilled mock expectations: %v", err)
	}
}
