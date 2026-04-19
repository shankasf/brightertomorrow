package handlers

import (
	"strings"
	"testing"
)

func TestContactRequestValidate(t *testing.T) {
	validEmail := "user@example.com"
	validMsg := "Hello there"

	tests := []struct {
		name    string
		req     contactRequest
		wantErr error
	}{
		{
			name:    "all valid",
			req:     contactRequest{FullName: "Alice", Email: validEmail, Message: validMsg},
			wantErr: nil,
		},
		{
			name:    "empty full_name",
			req:     contactRequest{FullName: "", Email: validEmail, Message: validMsg},
			wantErr: errContactFullName,
		},
		{
			name:    "201-char ASCII full_name",
			req:     contactRequest{FullName: strings.Repeat("a", 201), Email: validEmail, Message: validMsg},
			wantErr: errContactFullName,
		},
		{
			name: "200 non-Latin runes full_name passes (rune counting)",
			req: contactRequest{
				FullName: strings.Repeat("漢", 200),
				Email:    validEmail,
				Message:  validMsg,
			},
			wantErr: nil,
		},
		{
			name:    "invalid email",
			req:     contactRequest{FullName: "Alice", Email: "notanemail", Message: validMsg},
			wantErr: errContactEmail,
		},
		{
			name:    "51-char phone",
			req:     contactRequest{FullName: "Alice", Email: validEmail, Phone: strings.Repeat("1", 51), Message: validMsg},
			wantErr: errContactPhone,
		},
		{
			name:    "201-char subject",
			req:     contactRequest{FullName: "Alice", Email: validEmail, Subject: strings.Repeat("s", 201), Message: validMsg},
			wantErr: errContactSubject,
		},
		{
			name:    "empty message",
			req:     contactRequest{FullName: "Alice", Email: validEmail, Message: ""},
			wantErr: errContactMessage,
		},
		{
			name:    "5001-char message",
			req:     contactRequest{FullName: "Alice", Email: validEmail, Message: strings.Repeat("m", 5001)},
			wantErr: errContactMessage,
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
