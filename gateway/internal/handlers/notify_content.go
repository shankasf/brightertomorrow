package handlers

// notify_content.go — shared helpers for patient email notification content.
//
// HIPAA minimum-necessary: confirmation emails may contain first name,
// appointment date/time, therapist name, and callback number only.
// NEVER include diagnosis, reason-for-visit/Notes, insurance/payer,
// member ID, DOB, or financial info in any email body.
//
// The Lambda (notifications-retry) owns all HTML rendering, branding, logo,
// CTA buttons, and footer. The gateway sends a structured content payload;
// the Lambda wraps it in the branded template before delivery.
//
// All enqueue calls are best-effort: gate on NotifyEnabled + non-nil store,
// log warnings on error, never fail the HTTP request.

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/calendar"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
)

const (
	// clinicTZ is the practice location (Las Vegas, NV — Pacific time).
	clinicTZ = "America/Los_Angeles"

	// notifyPhone is the public callback number for all patient-facing emails.
	notifyPhone = "725-238-6990"

	// notifyEmailSentLine is appended to a flow's patient-facing response
	// message ONLY when a confirmation email was actually enqueued, so the
	// chat/voice agent can truthfully tell the caller it's on its way.
	// No PHI: it does not read the address back (voice could be overheard).
	notifyEmailSentLine = "A confirmation email is on its way to your inbox."
)

// notifyGreeting returns "Hi {FirstName}" or "Hi there" when name is blank.
func notifyGreeting(firstName string) string {
	if firstName == "" {
		return "Hi there"
	}
	return "Hi " + firstName
}

// formatApptTime parses startISO (RFC3339) and formats it in the clinic's
// local timezone as "Monday, January 2, 2006 at 3:04 PM Pacific".
// Returns an empty string if parsing fails — callers fall back to generic
// wording when this is empty.
func formatApptTime(startISO string) string {
	if startISO == "" {
		return ""
	}
	t, err := time.Parse(time.RFC3339, startISO)
	if err != nil {
		return ""
	}
	loc, err := time.LoadLocation(clinicTZ)
	if err != nil {
		// Extremely unlikely — clinicTZ is a valid IANA name bundled with Go.
		return ""
	}
	// "Monday, January 2, 2006 at 3:04 PM Pacific"
	return t.In(loc).Format("Monday, January 2, 2006 at 3:04 PM") + " Pacific"
}

// therapistDisplayName returns the calendar roster name for staffID, or
// "your therapist" if not found.
func therapistDisplayName(staffID int) string {
	if t, ok := calendar.ByID(staffID); ok {
		return t.Name
	}
	return "your therapist"
}

// emailStructured is the payload shape the Lambda renders into branded HTML.
// paragraphs are plain text — the Lambda HTML-escapes and wraps each one.
// details is an optional [label, value] table shown in a highlighted box.
// Render order: paragraph[0] → details box → remaining paragraphs.
//
// HIPAA minimum-necessary: never put diagnosis/insurance/payer/member-id/DOB
// or financial info in the details box.
type emailStructured struct {
	Subject    string      `json:"subject"`
	Heading    string      `json:"heading"`
	Paragraphs []string    `json:"paragraphs"`
	Details    [][2]string `json:"details,omitempty"`
	// CancelNotice, when true, tells the Lambda to append the cancellation
	// policy (48-hour fee + "My Account" link). Set ONLY for cancel/reschedule
	// emails — never booking-request / contact acks.
	CancelNotice bool `json:"cancel_notice,omitempty"`
}

// emailPayload marshals the structured content payload that EnqueueNotification
// expects. Returns ("", false) if marshalling somehow fails.
func emailPayload(subject, heading string, paragraphs []string, details [][2]string, cancelNotice bool) (string, bool) {
	b, err := json.Marshal(emailStructured{
		Subject:      subject,
		Heading:      heading,
		Paragraphs:   paragraphs,
		Details:      details,
		CancelNotice: cancelNotice,
	})
	if err != nil {
		return "", false
	}
	return string(b), true
}

// enqueueEmail is the single call-site helper shared by all booking flows.
// It is intentionally a free function so each handler can call it with its
// own store reference without embedding a handler type.
//
// All errors are logged and swallowed — callers must not fail over a missed
// notification. Returns true only when the row was durably enqueued, so the
// caller may truthfully tell the patient a confirmation email is on its way.
func enqueueEmail(
	ctx context.Context,
	store *phi.NotificationStore,
	recipient, subject, heading string,
	paragraphs []string,
	details [][2]string,
	cancelNotice bool,
	dedupeKey, logID string,
) bool {
	payload, ok := emailPayload(subject, heading, paragraphs, details, cancelNotice)
	if !ok {
		slog.Warn("notify: email payload marshal failed", "log_id", logID)
		return false
	}
	if err := store.EnqueueNotification(ctx, "email", recipient, payload, dedupeKey); err != nil {
		slog.Warn("notify: enqueue email failed",
			"log_id", logID, "channel", "email", "err", err)
		return false
	}
	return true
}

// ---------------------------------------------------------------------------
// Content builders — one per notification type.
// Each returns (subject, heading, paragraphs, details) ready for emailPayload.
// ---------------------------------------------------------------------------

// buildBookingRequestAckContent returns content for the patient-facing booking
// request received email sent immediately after an AI agent books a slot.
// No appointment time is included — the booking is not yet confirmed by staff.
func buildBookingRequestAckContent(greeting string) (subject, heading string, paragraphs []string, details [][2]string) {
	subject = "We've received your request — Brighter Tomorrow Therapy"
	heading = "We've received your request"
	paragraphs = []string{
		fmt.Sprintf("%s, thanks for reaching out to Brighter Tomorrow Therapy. We've received your request and a member of our care team will reach out shortly to confirm the details and next steps.", greeting),
		"If anything's urgent, just call us using the button below.",
	}
	// details intentionally nil — the booking is not framed as confirmed.
	return
}

// buildContactAckContent returns content for the acknowledgement email sent to
// a visitor immediately after they submit the public website contact form.
// No appointment, no read-back of what was submitted — minimum-necessary: a
// greeting, "request received, our team will be in touch", and a call CTA.
func buildContactAckContent(greeting string) (subject, heading string, paragraphs []string, details [][2]string) {
	subject = "We've received your request — Brighter Tomorrow Therapy"
	heading = "Your request has been submitted"
	paragraphs = []string{
		fmt.Sprintf("%s, thank you for reaching out to Brighter Tomorrow Therapy. Your request has been submitted and a member of our team will be in touch with you shortly.", greeting),
		"If anything's urgent, you can reach us anytime using the button below.",
	}
	// details intentionally nil — no health info or submitted values echoed back.
	return
}

// buildScheduledContent returns content for an appointment-scheduled email.
// Used ONLY when an admin actively sets the status to "scheduled", meaning a
// real appointment time has been confirmed by the care team.
//
//   - greeting:      "Hi FirstName" or "Hi there"
//   - therapistName: from calendar roster or "your therapist"
//   - apptFormatted: result of formatApptTime, or "" for generic fallback
//
// When apptFormatted is non-empty the When row is included in the details box.
func buildScheduledContent(greeting, therapistName, apptFormatted string) (subject, heading string, paragraphs []string, details [][2]string) {
	subject = "Your appointment is scheduled — Brighter Tomorrow Therapy"
	heading = "Your appointment is scheduled"

	if apptFormatted != "" {
		paragraphs = []string{
			fmt.Sprintf("%s, your appointment is scheduled.", greeting),
			"Need to reschedule? Just call us using the button below.",
		}
		details = [][2]string{
			{"Therapist", therapistName},
			{"When", apptFormatted},
		}
	} else {
		paragraphs = []string{
			fmt.Sprintf("%s, your appointment with %s is scheduled.", greeting, therapistName),
			"Need to reschedule? Just call us using the button below.",
		}
		details = [][2]string{
			{"Therapist", therapistName},
		}
	}
	return
}

// buildRequestAckContent returns content for the intake-submission ACK email
// sent immediately after a patient submits the web booking form.
// No coverage/insurance/appointment details are included.
func buildRequestAckContent(greeting string) (subject, heading string, paragraphs []string, details [][2]string) {
	subject = "We received your request — Brighter Tomorrow Therapy"
	heading = "We've received your request"
	paragraphs = []string{
		fmt.Sprintf("%s, thanks for reaching out to Brighter Tomorrow Therapy.", greeting),
		"We've received your request and a member of our care team will reach out within one business day to confirm the details and next steps.",
	}
	// details intentionally nil — no appointment specifics at this stage.
	return
}

// buildApprovedContent returns content for an appointment-request-approved email.
func buildApprovedContent(greeting string) (subject, heading string, paragraphs []string, details [][2]string) {
	subject = "Your appointment request is approved"
	heading = "Your request is approved"
	paragraphs = []string{
		fmt.Sprintf("%s, your appointment request with Brighter Tomorrow Therapy has been approved.", greeting),
		"We'll be in touch shortly with next steps.",
	}
	return
}

// buildCancelledContent returns content for an appointment-cancelled email.
func buildCancelledContent(greeting string) (subject, heading string, paragraphs []string, details [][2]string) {
	subject = "Your appointment has been cancelled"
	heading = "Your appointment has been cancelled"
	paragraphs = []string{
		fmt.Sprintf("%s, your appointment with Brighter Tomorrow Therapy has been cancelled.", greeting),
		"To rebook, just call us using the button below.",
	}
	return
}

// buildRescheduleRequestedDetailContent returns content for a chat/voice
// reschedule. Per product policy the patient is told this is a REQUEST pending
// care-team confirmation — NOT yet confirmed — even though the backend has
// applied the move. Names the requested new time + therapist so the patient
// knows what they asked for. (Distinct from buildRescheduleRequestedContent,
// the admin-side, no-specific-time variant.)
//
//   - greeting:      "Hi FirstName" or "Hi there"
//   - therapistName: from calendar roster or "your therapist"
//   - apptFormatted: result of formatApptTime, or "" for generic fallback
func buildRescheduleRequestedDetailContent(greeting, therapistName, apptFormatted string) (subject, heading string, paragraphs []string, details [][2]string) {
	subject = "We've received your reschedule request — Brighter Tomorrow Therapy"
	heading = "We've received your reschedule request"

	if apptFormatted != "" {
		paragraphs = []string{
			fmt.Sprintf("%s, we've received your request to reschedule your appointment. Here's the new time you requested:", greeting),
			"A member of our care team will confirm this shortly. If anything's urgent, just call us using the button below.",
		}
		details = [][2]string{
			{"Therapist", therapistName},
			{"Requested time", apptFormatted},
		}
	} else {
		paragraphs = []string{
			fmt.Sprintf("%s, we've received your request to reschedule your appointment with %s. A member of our care team will confirm the new time shortly.", greeting, therapistName),
			"If anything's urgent, just call us using the button below.",
		}
		details = [][2]string{
			{"Therapist", therapistName},
		}
	}
	return
}

// buildRescheduleRequestedContent returns content for a reschedule-request
// acknowledgement email.
func buildRescheduleRequestedContent(greeting string) (subject, heading string, paragraphs []string, details [][2]string) {
	subject = "We've received your reschedule request — Brighter Tomorrow Therapy"
	heading = "We've received your reschedule request"
	paragraphs = []string{
		fmt.Sprintf("%s, we've received your request to reschedule. A member of our care team will reach out shortly to find a new time that works for you.", greeting),
		"If anything's urgent, just call us using the button below.",
	}
	return
}

// buildCancelRequestedContent returns content for a cancellation-request
// acknowledgement email.
func buildCancelRequestedContent(greeting string) (subject, heading string, paragraphs []string, details [][2]string) {
	subject = "We've received your cancellation request — Brighter Tomorrow Therapy"
	heading = "We've received your cancellation request"
	paragraphs = []string{
		fmt.Sprintf("%s, we've received your request to cancel your appointment. We'll follow up shortly to confirm.", greeting),
		"If you'd like to keep or change the appointment instead, just call us using the button below.",
	}
	return
}

// buildCompletedContent returns content for a session-completed thank-you email.
func buildCompletedContent(greeting string) (subject, heading string, paragraphs []string, details [][2]string) {
	subject = "Thank you for visiting Brighter Tomorrow Therapy"
	heading = "Thank you for visiting"
	paragraphs = []string{
		fmt.Sprintf("%s, thank you for visiting Brighter Tomorrow Therapy. We hope your session was helpful.", greeting),
		"If you'd like to schedule a follow-up, just call us using the button below.",
	}
	return
}
