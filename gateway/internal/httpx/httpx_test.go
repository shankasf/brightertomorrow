package httpx

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReadJSON(t *testing.T) {
	type payload struct {
		Name string `json:"name"`
	}

	tests := []struct {
		name    string
		body    string
		wantErr bool
	}{
		{
			name:    "valid JSON",
			body:    `{"name":"Alice"}`,
			wantErr: false,
		},
		{
			name:    "unknown fields",
			body:    `{"name":"Alice","extra":"field"}`,
			wantErr: true,
		},
		{
			name:    "oversized body",
			body:    strings.Repeat("x", maxBodyBytes+1),
			wantErr: true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodPost, "/", bytes.NewBufferString(tc.body))
			w := httptest.NewRecorder()
			var v payload
			err := ReadJSON(w, r, &v)
			if tc.wantErr && err == nil {
				t.Error("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
			if !tc.wantErr && v.Name != "Alice" {
				t.Errorf("expected Name=Alice, got %q", v.Name)
			}
		})
	}
}

func TestWriteValidationError(t *testing.T) {
	w := httptest.NewRecorder()
	WriteValidationError(w, "bad")

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected status 400, got %d", w.Code)
	}

	var got map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
		t.Fatalf("unmarshal body: %v", err)
	}
	if got["error"] != "validation" {
		t.Errorf("expected error=validation, got %q", got["error"])
	}
	if got["detail"] != "bad" {
		t.Errorf("expected detail=bad, got %q", got["detail"])
	}
}
