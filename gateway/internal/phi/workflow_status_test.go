package phi

import "testing"

func TestIsValidWorkflowStatus(t *testing.T) {
	valid := []string{
		"new", "in_review", "approved", "scheduled",
		"reschedule_requested", "cancel_requested",
		"cancelled", "no_show", "completed", "rejected", "archived",
	}
	for _, s := range valid {
		if !IsValidWorkflowStatus(s) {
			t.Errorf("IsValidWorkflowStatus(%q) = false, want true", s)
		}
	}

	invalid := []string{
		"", "APPROVED", "pending", "active", "done", "all",
		"New", "CANCELLED", "unknown",
	}
	for _, s := range invalid {
		if IsValidWorkflowStatus(s) {
			t.Errorf("IsValidWorkflowStatus(%q) = true, want false", s)
		}
	}
}
