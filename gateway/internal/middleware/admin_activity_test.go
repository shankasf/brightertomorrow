package middleware

import "testing"

func TestDeriveAction(t *testing.T) {
	tests := []struct {
		method           string
		path             string
		wantAction       string
		wantResourceType string
		wantResourceID   string
	}{
		{
			method:           "GET",
			path:             "/admin/api/appointments",
			wantAction:       "view_appointments_list",
			wantResourceType: "appointments",
			wantResourceID:   "",
		},
		{
			method:           "GET",
			path:             "/admin/api/appointments.csv",
			wantAction:       "export_appointments_csv",
			wantResourceType: "appointments",
			wantResourceID:   "",
		},
		{
			method:           "GET",
			path:             "/admin/api/contacts/42",
			wantAction:       "view_contact",
			wantResourceType: "contacts",
			wantResourceID:   "42",
		},
		{
			method:           "GET",
			path:             "/admin/api/audit/phi",
			wantAction:       "view_phi_audit_log",
			wantResourceType: "audit_phi",
			wantResourceID:   "",
		},
		{
			method:           "POST",
			path:             "/admin/api/audit/purge/contact/99",
			wantAction:       "purge_contact",
			wantResourceType: "purge",
			wantResourceID:   "99",
		},
		{
			method:           "DELETE",
			path:             "/admin/api/content/faqs/7",
			wantAction:       "delete_faq",
			wantResourceType: "faqs",
			wantResourceID:   "7",
		},
		{
			// Newsletter deletion with sub-path suffix.
			method:           "POST",
			path:             "/admin/api/newsletter/12/request-deletion",
			wantAction:       "request_newsletter_deletion",
			wantResourceType: "newsletter",
			wantResourceID:   "12",
		},
		{
			// Unmapped path falls back to <method>_<last_segment>.
			method:           "GET",
			path:             "/admin/api/some-new-feature",
			wantAction:       "get_some_new_feature",
			wantResourceType: "admin_console",
			wantResourceID:   "",
		},
	}

	for _, tc := range tests {
		t.Run(tc.method+" "+tc.path, func(t *testing.T) {
			action, resourceType, resourceID := deriveAction(tc.method, tc.path)
			if action != tc.wantAction {
				t.Errorf("action: got %q, want %q", action, tc.wantAction)
			}
			if resourceType != tc.wantResourceType {
				t.Errorf("resourceType: got %q, want %q", resourceType, tc.wantResourceType)
			}
			if resourceID != tc.wantResourceID {
				t.Errorf("resourceID: got %q, want %q", resourceID, tc.wantResourceID)
			}
		})
	}
}

func TestShouldSkipActivityLog(t *testing.T) {
	tests := []struct {
		path string
		want bool
	}{
		{"/admin/api/auth/login", true},
		{"/admin/api/auth/me", true},
		{"/admin/api/auth/exchange", true},
		{"/admin/api/stats", true},
		{"/admin/api/appointments", false},
		{"/admin/api/appointments.csv", false},
		{"/admin/api/audit/access", false},
	}
	for _, tc := range tests {
		t.Run(tc.path, func(t *testing.T) {
			if got := shouldSkipActivityLog(tc.path); got != tc.want {
				t.Errorf("shouldSkipActivityLog(%q) = %v, want %v", tc.path, got, tc.want)
			}
		})
	}
}
