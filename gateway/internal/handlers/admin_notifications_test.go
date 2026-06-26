package handlers

import "testing"

// TestIsNotifSection guards the section allow-list used by the Seen endpoint:
// only the six canonical badge sections are accepted, everything else (typos,
// empty, injection attempts) is rejected before it reaches the DB upsert.
func TestIsNotifSection(t *testing.T) {
	valid := []string{
		"appointments", "callbacks", "insurance_checks",
		"contacts", "chat", "newsletter",
	}
	for _, s := range valid {
		if !isNotifSection(s) {
			t.Errorf("isNotifSection(%q) = false, want true", s)
		}
	}

	invalid := []string{
		"", "Appointments", "insurance-checks", "audit",
		"dashboard", "callbacks ", "'; DROP TABLE bt.admin_nav_seen; --",
	}
	for _, s := range invalid {
		if isNotifSection(s) {
			t.Errorf("isNotifSection(%q) = true, want false", s)
		}
	}

	// Every section the counts endpoint reports must also be a valid Seen
	// target, otherwise a badge could never be cleared.
	for _, s := range notifSections {
		if !isNotifSection(s) {
			t.Errorf("notifSections entry %q not accepted by isNotifSection", s)
		}
	}
}
