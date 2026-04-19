package handlers

import (
	"strings"
	"testing"
)

func TestNewsletterRequestValidate(t *testing.T) {
	tests := []struct {
		name    string
		req     newsletterRequest
		wantErr error
	}{
		{
			name:    "valid email",
			req:     newsletterRequest{Email: "user@example.com"},
			wantErr: nil,
		},
		{
			name:    "empty email",
			req:     newsletterRequest{Email: ""},
			wantErr: errNewsletterEmail,
		},
		{
			name:    "missing @ in email",
			req:     newsletterRequest{Email: "notanemail"},
			wantErr: errNewsletterEmail,
		},
		{
			name:    "201-char email",
			req:     newsletterRequest{Email: strings.Repeat("a", 197) + "@b.c"},
			wantErr: errNewsletterEmail,
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
