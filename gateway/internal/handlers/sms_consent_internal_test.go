package handlers

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
)

var errFakePut = errors.New("fake putitem failure")

func newSMSConsentHandler(ddb phi.DDBClient, secret string) *SMSConsentInternalHandler {
	store, err := phi.New(phi.Config{DDB: ddb, TableName: "bt-main-test", Timeout: 3 * time.Second})
	if err != nil {
		panic(err)
	}
	return &SMSConsentInternalHandler{PHI: store, InternalSecret: secret}
}

func doConsentPost(t *testing.T, h *SMSConsentInternalHandler, body, secret string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/internal/sms/consent", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if secret != "" {
		req.Header.Set("X-Internal-Secret", secret)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestSMSConsent_OK(t *testing.T) {
	h := newSMSConsentHandler(&fakeDDB{}, "s3cr3t")
	w := doConsentPost(t, h, `{"phone":"702-555-1234","opted_in":true,"method":"chat","session_id":"sess-1"}`, "s3cr3t")
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", w.Code, w.Body.String())
	}
	var resp map[string]any
	_ = json.NewDecoder(w.Body).Decode(&resp)
	if resp["ok"] != true {
		t.Errorf("ok = %v, want true", resp["ok"])
	}
}

func TestSMSConsent_BadSecret(t *testing.T) {
	h := newSMSConsentHandler(&fakeDDB{}, "s3cr3t")
	w := doConsentPost(t, h, `{"phone":"7025551234","opted_in":true,"method":"voice"}`, "wrong")
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", w.Code)
	}
}

func TestSMSConsent_MethodMustBeChatOrVoice(t *testing.T) {
	h := newSMSConsentHandler(&fakeDDB{}, "")
	// web_booking is valid in the store but NOT on this internal endpoint.
	w := doConsentPost(t, h, `{"phone":"7025551234","opted_in":true,"method":"web_booking"}`, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for non-conversational method", w.Code)
	}
}

func TestSMSConsent_MissingPhone(t *testing.T) {
	h := newSMSConsentHandler(&fakeDDB{}, "")
	w := doConsentPost(t, h, `{"opted_in":true,"method":"chat"}`, "")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for missing phone", w.Code)
	}
}

func TestSMSConsent_StoreError(t *testing.T) {
	h := newSMSConsentHandler(&fakeDDB{putItemErr: errFakePut}, "")
	w := doConsentPost(t, h, `{"phone":"7025551234","opted_in":false,"method":"voice"}`, "")
	if w.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500 on store failure", w.Code)
	}
}
