package handlers_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/handlers"
)

// mockAIChatter verifies that the exported AIChatter interface is satisfied.
type mockAIChatter struct{}

func (m *mockAIChatter) Chat(_ context.Context, _, _ string) (string, error) {
	return "mock reply", nil
}

// compile-time interface check
var _ handlers.AIChatter = (*mockAIChatter)(nil)

func TestEnsureVisitor_NoCookie(t *testing.T) {
	r := httptest.NewRequest(http.MethodPost, "/v1/chat", nil)
	w := httptest.NewRecorder()

	id := handlers.EnsureVisitor(w, r)

	if id == "" {
		t.Fatal("expected non-empty visitor ID")
	}

	resp := w.Result()
	var found bool
	for _, c := range resp.Cookies() {
		if c.Name == "bt_visitor" {
			found = true
			if c.Value != id {
				t.Errorf("cookie value %q != returned id %q", c.Value, id)
			}
		}
	}
	if !found {
		t.Error("expected Set-Cookie header for bt_visitor, none found")
	}
}

func TestEnsureVisitor_ValidCookie(t *testing.T) {
	const existingID = "550e8400-e29b-41d4-a716-446655440000"

	r := httptest.NewRequest(http.MethodPost, "/v1/chat", nil)
	r.AddCookie(&http.Cookie{Name: "bt_visitor", Value: existingID})
	w := httptest.NewRecorder()

	id := handlers.EnsureVisitor(w, r)

	if id != existingID {
		t.Errorf("expected %q, got %q", existingID, id)
	}

	resp := w.Result()
	for _, c := range resp.Cookies() {
		if c.Name == "bt_visitor" {
			t.Error("expected no Set-Cookie for a valid existing cookie")
		}
	}
}

func TestChatRequestValidate(t *testing.T) {
	type chatReq interface {
		// We call validate via the exported test helper below.
	}
	_ = chatReq(nil)

	tests := []struct {
		name    string
		message string
		wantErr bool
	}{
		{
			name:    "valid 1-char message",
			message: "H",
			wantErr: false,
		},
		{
			name:    "empty message",
			message: "",
			wantErr: true,
		},
		{
			name:    "2001-char message",
			message: strings.Repeat("x", 2001),
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := handlers.ValidateChatMessage(tc.message)
			if tc.wantErr && err == nil {
				t.Error("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}
