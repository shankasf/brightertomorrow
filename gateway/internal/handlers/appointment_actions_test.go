package handlers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
)

// ---------------------------------------------------------------------------
// Minimal fake DDBClient used only in this file.
// Only Query and PutItem are exercised; the rest panic so a test that
// unexpectedly hits them gives an obvious failure rather than silent noop.
// ---------------------------------------------------------------------------

type fakeDDB struct {
	// queryItems is the list of raw DDB item maps returned by Query.
	queryItems []map[string]ddbtypes.AttributeValue
	// putItemErr, if non-nil, is returned by PutItem (audit writes go here).
	putItemErr error
	// updateItemErr is returned by UpdateItem.
	updateItemErr error
	// updateItemCondFail, if true, returns a ConditionalCheckFailedException.
	updateItemCondFail bool
}

func (f *fakeDDB) PutItem(_ context.Context, _ *dynamodb.PutItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error) {
	return &dynamodb.PutItemOutput{}, f.putItemErr
}
func (f *fakeDDB) GetItem(_ context.Context, _ *dynamodb.GetItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error) {
	panic("fakeDDB.GetItem not implemented")
}
func (f *fakeDDB) UpdateItem(_ context.Context, _ *dynamodb.UpdateItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error) {
	if f.updateItemCondFail {
		return nil, &ddbtypes.ConditionalCheckFailedException{}
	}
	return &dynamodb.UpdateItemOutput{}, f.updateItemErr
}
func (f *fakeDDB) BatchGetItem(_ context.Context, _ *dynamodb.BatchGetItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.BatchGetItemOutput, error) {
	panic("fakeDDB.BatchGetItem not implemented")
}
func (f *fakeDDB) DeleteItem(_ context.Context, _ *dynamodb.DeleteItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error) {
	panic("fakeDDB.DeleteItem not implemented")
}
func (f *fakeDDB) Query(_ context.Context, _ *dynamodb.QueryInput, _ ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error) {
	return &dynamodb.QueryOutput{Items: f.queryItems}, nil
}
func (f *fakeDDB) BatchWriteItem(_ context.Context, _ *dynamodb.BatchWriteItemInput, _ ...func(*dynamodb.Options)) (*dynamodb.BatchWriteItemOutput, error) {
	panic("fakeDDB.BatchWriteItem not implemented")
}
func (f *fakeDDB) DescribeTable(_ context.Context, _ *dynamodb.DescribeTableInput, _ ...func(*dynamodb.Options)) (*dynamodb.DescribeTableOutput, error) {
	panic("fakeDDB.DescribeTable not implemented")
}

// ---------------------------------------------------------------------------
// Helper: build a marshalled IntakeRecord item map.
// ---------------------------------------------------------------------------

func marshalIntakeRecord(t *testing.T, rec phi.IntakeRecord) map[string]ddbtypes.AttributeValue {
	t.Helper()
	item, err := attributevalue.MarshalMap(rec)
	if err != nil {
		t.Fatalf("marshalIntakeRecord: %v", err)
	}
	return item
}

// ---------------------------------------------------------------------------
// LookupAppointment tests
// ---------------------------------------------------------------------------

func newLookupHandler(ddb phi.DDBClient) *InternalCalendarHandler {
	store, err := phi.New(phi.Config{
		DDB:       ddb,
		TableName: "bt-main-test",
		Timeout:   3 * time.Second,
	})
	if err != nil {
		panic(err)
	}
	return &InternalCalendarHandler{
		PHI:            store,
		InternalSecret: "", // disabled — tests don't send the header
	}
}

func doLookupPost(t *testing.T, h *InternalCalendarHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/internal/calendar/lookup_appointment", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.LookupAppointment(w, req)
	return w
}

// TestLookupAppointment_NotFound: no records in DDB → {"found":false}.
func TestLookupAppointment_NotFound(t *testing.T) {
	h := newLookupHandler(&fakeDDB{queryItems: nil})
	w := doLookupPost(t, h, `{"phone":"8453884267","dob_yyyymmdd":"19900510"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["found"] != false {
		t.Errorf("found = %v, want false", resp["found"])
	}
	if _, hasAppt := resp["appointment_time_iso"]; hasAppt {
		t.Errorf("appointment_time_iso must not appear when found=false")
	}
}

// TestLookupAppointment_WrongDOB: phone match exists but DOB doesn't match →
// {"found":false,"reason":"verification_failed"} — no appointment details leaked.
func TestLookupAppointment_WrongDOB(t *testing.T) {
	future := time.Now().UTC().Add(48 * time.Hour)
	staffID := 1
	rec := phi.IntakeRecord{
		SubmissionUUID:   "appt-uuid-001",
		EmailHash:        "ehash001",
		DateOfBirth:      "1990-05-10", // stored as YYYY-MM-DD
		Phone:            "8453884267",
		PhoneHash:        phi.HashPhone("8453884267"),
		WorkflowStatus:   "scheduled",
		AppointmentTime:  &future,
		TherapistStaffID: &staffID,
		CoverageStatus:   "eligible",
		CreatedAt:        time.Now().UTC(),
		RetainUntil:      time.Now().UTC().Add(10 * 365 * 24 * time.Hour),
	}
	item := marshalIntakeRecord(t, rec)

	h := newLookupHandler(&fakeDDB{queryItems: []map[string]ddbtypes.AttributeValue{item}})
	// Send a WRONG DOB.
	w := doLookupPost(t, h, `{"phone":"8453884267","dob_yyyymmdd":"19850101"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["found"] != false {
		t.Errorf("found = %v, want false on DOB mismatch", resp["found"])
	}
	if resp["reason"] != "verification_failed" {
		t.Errorf("reason = %v, want verification_failed", resp["reason"])
	}
	// Critical: no appointment details must leak.
	for _, forbidden := range []string{"appointment_time_iso", "therapist_staff_id", "appointment_id"} {
		if _, ok := resp[forbidden]; ok {
			t.Errorf("field %q must not be present on DOB mismatch", forbidden)
		}
	}
}

// TestLookupAppointment_CorrectDOB: phone + DOB match → full appointment details.
func TestLookupAppointment_CorrectDOB(t *testing.T) {
	future := time.Now().UTC().Add(48 * time.Hour)
	staffID := 2
	rec := phi.IntakeRecord{
		SubmissionUUID:   "appt-uuid-002",
		EmailHash:        "ehash002",
		DateOfBirth:      "1990-05-10",
		Phone:            "8453884267",
		PhoneHash:        phi.HashPhone("8453884267"),
		WorkflowStatus:   "scheduled",
		AppointmentTime:  &future,
		TherapistStaffID: &staffID,
		CoverageStatus:   "eligible",
		CreatedAt:        time.Now().UTC(),
		RetainUntil:      time.Now().UTC().Add(10 * 365 * 24 * time.Hour),
	}
	item := marshalIntakeRecord(t, rec)

	h := newLookupHandler(&fakeDDB{queryItems: []map[string]ddbtypes.AttributeValue{item}})
	w := doLookupPost(t, h, `{"phone":"(845) 388-4267","dob_yyyymmdd":"19900510"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["found"] != true {
		t.Errorf("found = %v, want true", resp["found"])
	}
	if resp["appointment_id"] != "appt-uuid-002" {
		t.Errorf("appointment_id = %v, want appt-uuid-002", resp["appointment_id"])
	}
	if resp["email_hash"] != "ehash002" {
		t.Errorf("email_hash = %v, want ehash002", resp["email_hash"])
	}
	if resp["dob_match"] != true {
		t.Errorf("dob_match = %v, want true", resp["dob_match"])
	}
	if resp["appointment_time_iso"] == nil || resp["appointment_time_iso"] == "" {
		t.Errorf("appointment_time_iso missing in found=true response")
	}
}

// TestLookupAppointment_PastDOBMatch: phone + DOB match but the appointment is
// in the past → {"found":false,"reason":"past_appointment"} with the date, and
// NO appointment_id / cancel-able details.
func TestLookupAppointment_PastDOBMatch(t *testing.T) {
	past := time.Now().UTC().Add(-48 * time.Hour)
	staffID := 2
	rec := phi.IntakeRecord{
		SubmissionUUID:   "appt-uuid-past",
		EmailHash:        "ehashpast",
		DateOfBirth:      "19900510", // YYYYMMDD form (AI booking)
		Phone:            "8453884267",
		PhoneHash:        phi.HashPhone("8453884267"),
		WorkflowStatus:   "scheduled",
		AppointmentTime:  &past,
		TherapistStaffID: &staffID,
		CoverageStatus:   "eligible",
		CreatedAt:        time.Now().UTC(),
		RetainUntil:      time.Now().UTC().Add(10 * 365 * 24 * time.Hour),
	}
	item := marshalIntakeRecord(t, rec)

	h := newLookupHandler(&fakeDDB{queryItems: []map[string]ddbtypes.AttributeValue{item}})
	w := doLookupPost(t, h, `{"phone":"8453884267","dob_yyyymmdd":"19900510"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["found"] != false {
		t.Errorf("found = %v, want false for a past appointment", resp["found"])
	}
	if resp["reason"] != "past_appointment" {
		t.Errorf("reason = %v, want past_appointment", resp["reason"])
	}
	if resp["appointment_time_iso"] == nil || resp["appointment_time_iso"] == "" {
		t.Errorf("appointment_time_iso should be present so the agent can name the past date")
	}
	// Must NOT hand back anything that lets the caller cancel.
	for _, forbidden := range []string{"appointment_id", "email_hash", "therapist_staff_id"} {
		if _, ok := resp[forbidden]; ok {
			t.Errorf("field %q must not be present for a past appointment", forbidden)
		}
	}
}

// TestLookupAppointment_CancelledSkipped: cancelled record in GSI result is
// skipped even if DOB would match.
func TestLookupAppointment_CancelledSkipped(t *testing.T) {
	future := time.Now().UTC().Add(48 * time.Hour)
	staffID := 1
	cancelled := phi.IntakeRecord{
		SubmissionUUID:   "appt-cancelled",
		EmailHash:        "ehash003",
		DateOfBirth:      "1990-05-10",
		Phone:            "8453884267",
		PhoneHash:        phi.HashPhone("8453884267"),
		WorkflowStatus:   "cancelled",
		AppointmentTime:  &future,
		TherapistStaffID: &staffID,
		CoverageStatus:   "eligible",
		CreatedAt:        time.Now().UTC(),
		RetainUntil:      time.Now().UTC().Add(10 * 365 * 24 * time.Hour),
	}
	item := marshalIntakeRecord(t, cancelled)

	h := newLookupHandler(&fakeDDB{queryItems: []map[string]ddbtypes.AttributeValue{item}})
	w := doLookupPost(t, h, `{"phone":"8453884267","dob_yyyymmdd":"19900510"}`)

	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["found"] != false {
		t.Errorf("cancelled appointment must not be returned; got found=%v", resp["found"])
	}
}

// TestLookupAppointment_PastSkipped: past appointment is skipped.
func TestLookupAppointment_PastSkipped(t *testing.T) {
	past := time.Now().UTC().Add(-48 * time.Hour)
	staffID := 1
	rec := phi.IntakeRecord{
		SubmissionUUID:   "appt-past",
		EmailHash:        "ehash004",
		DateOfBirth:      "1990-05-10",
		Phone:            "8453884267",
		PhoneHash:        phi.HashPhone("8453884267"),
		WorkflowStatus:   "completed",
		AppointmentTime:  &past,
		TherapistStaffID: &staffID,
		CoverageStatus:   "eligible",
		CreatedAt:        time.Now().UTC(),
		RetainUntil:      time.Now().UTC().Add(10 * 365 * 24 * time.Hour),
	}
	item := marshalIntakeRecord(t, rec)

	h := newLookupHandler(&fakeDDB{queryItems: []map[string]ddbtypes.AttributeValue{item}})
	w := doLookupPost(t, h, `{"phone":"8453884267","dob_yyyymmdd":"19900510"}`)

	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["found"] != false {
		t.Errorf("past appointment must not be returned; got found=%v", resp["found"])
	}
}

// TestLookupAppointment_BadJSON: malformed body → 200 {"found":false} (fail-open).
func TestLookupAppointment_BadJSON(t *testing.T) {
	h := newLookupHandler(&fakeDDB{})
	req := httptest.NewRequest(http.MethodPost, "/internal/calendar/lookup_appointment", strings.NewReader(`not json`))
	w := httptest.NewRecorder()
	h.LookupAppointment(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (fail-open)", w.Code)
	}
	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["found"] != false {
		t.Errorf("bad JSON should yield found=false, got %v", resp["found"])
	}
}

// ---------------------------------------------------------------------------
// CancelAppointment tests
// ---------------------------------------------------------------------------

func doCancelPost(t *testing.T, h *InternalCalendarHandler, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/internal/calendar/cancel", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.CancelAppointment(w, req)
	return w
}

func TestCancelAppointment_Success(t *testing.T) {
	h := newLookupHandler(&fakeDDB{}) // UpdateItem returns nil by default
	w := doCancelPost(t, h, `{"appointmentId":"appt-001","emailHash":"ehash001"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["ok"] != true {
		t.Errorf("ok = %v, want true", resp["ok"])
	}
}

func TestCancelAppointment_NotFound(t *testing.T) {
	h := newLookupHandler(&fakeDDB{updateItemCondFail: true})
	w := doCancelPost(t, h, `{"appointmentId":"appt-missing","emailHash":"ehash-missing"}`)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", w.Code)
	}
	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["ok"] != false {
		t.Errorf("ok = %v, want false", resp["ok"])
	}
	if resp["error"] != "not_found" {
		t.Errorf("error = %v, want not_found", resp["error"])
	}
}

func TestCancelAppointment_MissingFields(t *testing.T) {
	h := newLookupHandler(&fakeDDB{})
	tests := []struct {
		name string
		body string
	}{
		{"missing appointmentId", `{"emailHash":"ehash001"}`},
		{"missing emailHash", `{"appointmentId":"appt-001"}`},
		{"both empty", `{}`},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w := doCancelPost(t, h, tc.body)
			if w.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400", w.Code)
			}
		})
	}
}
