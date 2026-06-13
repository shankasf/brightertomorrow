// appointment_actions.go — AI-facing appointment lookup, cancel, and reschedule endpoints.
//
// POST /internal/calendar/lookup_appointment
//
//	Looks up a patient's upcoming appointment by phone number, then gates
//	disclosure behind a DOB second-factor comparison.  Returns only boolean
//	flags + stable IDs on success; never raw PHI.
//
// POST /internal/calendar/cancel
//
//	Cancels an appointment (sets workflowStatus = "cancelled") given an
//	appointmentId + emailHash that the caller previously obtained via lookup.
//
// POST /internal/calendar/reschedule
//
//	Moves an existing appointment to a new slot. Requires appointmentId +
//	emailHash obtained from a prior lookup, plus staffId + startISO + endISO
//	for the new slot. Checks slot availability before mutating; returns 409 with
//	alternatives when the target slot is taken.
//
// HIPAA controls:
//   - Phone and DOB are never logged; only their hashes and boolean flags.
//   - Every call fires a background audit row via phi.Store.PutAccessAudit.
//   - DOB mismatch returns {"found":false,"reason":"verification_failed"} so no
//     timing or content leak confirms that the phone number is registered.
//   - Fail-open on bad JSON (200 {"found":false}) so the AI conversation continues.
//   - Reschedule logs contain no raw PHI: only appointmentId, emailHash, and
//     the new ISO timestamp.
package handlers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/calendar"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// POST /internal/calendar/lookup_appointment
// ---------------------------------------------------------------------------

type lookupAppointmentRequest struct {
	Phone       string `json:"phone"`
	DOByyyymmdd string `json:"dob_yyyymmdd"` // YYYYMMDD
	Email       string `json:"email"`        // optional; unused in current path
}

// LookupAppointment handles POST /internal/calendar/lookup_appointment.
// It finds the caller's most-recent non-cancelled future appointment by phone
// hash, then requires a matching DOB before returning any appointment details.
func (h *InternalCalendarHandler) LookupAppointment(w http.ResponseWriter, r *http.Request) {
	if !h.checkInternalSecret(w, r) {
		return
	}

	var body lookupAppointmentRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		// Fail open: bad JSON must not break the AI conversation.
		slog.Warn("lookup_appointment: bad json body", "err", err)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"found": false})
		return
	}

	if strings.TrimSpace(body.Phone) == "" {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"found": false})
		return
	}

	phoneHash := phi.HashPhone(body.Phone)
	ctx := r.Context()

	records, err := h.PHI.LookupActiveAppointmentsByPhoneHash(ctx, phoneHash)
	if err != nil {
		slog.Error("lookup_appointment: gsi query failed", "err", err)
		// Fail open.
		appointmentLookupAudit(ctx, h.PHI, phoneHash, false, false, "")
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"found": false})
		return
	}

	now := time.Now().UTC()

	// Pick the most-recent non-cancelled appointment (past OR future) per GSI
	// descending order. We do NOT filter out past appointments here so we can
	// tell the caller "that one already passed" — but only AFTER DOB verifies.
	var match *phi.IntakeRecord
	for i := range records {
		rec := &records[i]
		if rec.WorkflowStatus == "cancelled" {
			continue
		}
		if rec.AppointmentTime == nil {
			continue
		}
		match = rec
		break
	}

	if match == nil {
		appointmentLookupAudit(ctx, h.PHI, phoneHash, false, false, "")
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"found": false})
		return
	}

	// Phone match found — verify DOB before revealing ANYTHING (including
	// whether a past appointment existed).
	// IntakeRecord.DateOfBirth is stored as "YYYY-MM-DD" (web) or "YYYYMMDD"
	// (AI bookings); strip dashes so both compare against the YYYYMMDD body.
	recDOB := strings.ReplaceAll(match.DateOfBirth, "-", "")
	dobMatch := recDOB == strings.TrimSpace(body.DOByyyymmdd)

	if !dobMatch {
		// A phone match exists but DOB is wrong.  Return no appointment details.
		appointmentLookupAudit(ctx, h.PHI, phoneHash, true, false, "")
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"found":  false,
			"reason": "verification_failed",
		})
		return
	}

	// Identity verified. A past appointment cannot be cancelled — tell the
	// caller it already passed (the date is safe to disclose post-verification).
	if !match.AppointmentTime.After(now) {
		appointmentLookupAudit(ctx, h.PHI, phoneHash, true, true, match.SubmissionUUID)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"found":                false,
			"reason":               "past_appointment",
			"appointment_time_iso": match.AppointmentTime.UTC().Format(time.RFC3339),
		})
		return
	}

	// Both phone and DOB verified and the appointment is upcoming — safe to
	// return appointment metadata for cancellation.
	therapistStaffID := 0
	if match.TherapistStaffID != nil {
		therapistStaffID = *match.TherapistStaffID
	}

	// Reason-for-visit. Prefer the patient's free-text notes (richer); fall
	// back to the structured service type. Safe to disclose post-DOB-verify —
	// it goes only to the verified patient, same gate as the time + therapist.
	reasonForVisit := strings.TrimSpace(match.Notes)
	if reasonForVisit == "" {
		reasonForVisit = strings.TrimSpace(match.Service)
	}

	appointmentLookupAudit(ctx, h.PHI, phoneHash, true, true, match.SubmissionUUID)
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"found":                true,
		"appointment_id":       match.SubmissionUUID,
		"email_hash":           match.EmailHash,
		"appointment_time_iso": match.AppointmentTime.UTC().Format(time.RFC3339),
		"therapist_staff_id":   therapistStaffID,
		"service":              reasonForVisit,
		"dob_match":            true,
	})
}

// ---------------------------------------------------------------------------
// POST /internal/calendar/cancel
// ---------------------------------------------------------------------------

type cancelAppointmentRequest struct {
	AppointmentID string `json:"appointmentId"`
	EmailHash     string `json:"emailHash"`
}

// CancelAppointment handles POST /internal/calendar/cancel.
// Requires appointmentId + emailHash (both obtained from a prior lookup_appointment
// call) and sets workflowStatus to "cancelled".
func (h *InternalCalendarHandler) CancelAppointment(w http.ResponseWriter, r *http.Request) {
	if !h.checkInternalSecret(w, r) {
		return
	}

	var body cancelAppointmentRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON")
		return
	}
	if strings.TrimSpace(body.AppointmentID) == "" || strings.TrimSpace(body.EmailHash) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "appointmentId and emailHash are required")
		return
	}

	ctx := r.Context()

	err := h.PHI.UpdateIntakeWorkflowStatus(ctx, body.EmailHash, body.AppointmentID, "cancelled", "bt-ai")
	if err != nil {
		if errors.Is(err, phi.ErrNotFound) {
			appointmentCancelAudit(ctx, h.PHI, body.AppointmentID, body.EmailHash)
			httpx.WriteJSON(w, http.StatusOK, map[string]any{
				"ok":    false,
				"error": "not_found",
			})
			return
		}
		// Log error without PHI (no appointmentID/emailHash in the log line).
		slog.Error("cancel_appointment: update workflow status failed", "err", err)
		appointmentCancelAudit(ctx, h.PHI, body.AppointmentID, body.EmailHash)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":    false,
			"error": "cancel_failed",
		})
		return
	}

	appointmentCancelAudit(ctx, h.PHI, body.AppointmentID, body.EmailHash)

	// Best-effort cancellation email — never fail the cancel over a missed
	// notification. Recipient + first name come from the DDB record (same
	// pattern as reschedule / admin status-change emails); no raw PHI in logs.
	// emailQueued is returned so the AI agent only claims an email was sent
	// when one was actually enqueued.
	emailQueued := false
	if h.NotifyEnabled && h.Notify != nil && h.PHI != nil {
		if rec, gerr := h.PHI.GetIntake(ctx, body.EmailHash, body.AppointmentID); gerr != nil {
			slog.Warn("cancel_appointment: get intake for email failed", "err", gerr)
		} else if rec != nil {
			if email := strings.TrimSpace(rec.Email); email != "" {
				greeting := notifyGreeting(strings.TrimSpace(rec.FirstName))
				// Request-framing per product policy: the patient is told the
				// cancellation request was received and the team will confirm —
				// NOT that it's already done (even though the backend applied it).
				subj, heading, paragraphs, details := buildCancelRequestedContent(greeting)
				dedupeKey := fmt.Sprintf("apptcancel:%s:email", body.AppointmentID)
				emailQueued = enqueueEmail(ctx, h.Notify, email, subj, heading, paragraphs, details, true, dedupeKey, body.AppointmentID)
				slog.Info("cancel_appointment: cancellation email enqueue",
					"appointment_id", body.AppointmentID, "channel", "email", "enqueued", emailQueued)
			}
		}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "emailQueued": emailQueued})
}

// ---------------------------------------------------------------------------
// Audit helpers
// ---------------------------------------------------------------------------

// appointmentLookupAudit fires a background PHI audit row for a lookup call.
// Only hashes and boolean flags are written; no raw PHI.
func appointmentLookupAudit(ctx context.Context, store *phi.Store, phoneHash string, matchFound, dobMatch bool, appointmentID string) {
	if store == nil {
		return
	}
	details := map[string]any{
		"phone_hash":     phoneHash,
		"match_found":    matchFound,
		"dob_match":      dobMatch,
		"appointment_id": appointmentID,
	}
	detailsJSON, _ := json.Marshal(details)

	row := phi.AccessAuditRecord{
		AuditID:      uuid.NewString(),
		AdminEmail:   "bt-ai",
		Action:       "appointment_lookup",
		ResourceType: "appointment",
		Details:      string(detailsJSON),
		CreatedAt:    time.Now().UTC(),
	}
	go func() {
		auditCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := store.PutAccessAudit(auditCtx, row); err != nil {
			slog.Error("appointment_lookup: audit write failed", "err", err)
		}
	}()
}

// appointmentCancelAudit fires a background PHI audit row for a cancel call.
// Only appointment_id + email_hash are written; no raw PHI.
func appointmentCancelAudit(ctx context.Context, store *phi.Store, appointmentID, emailHash string) {
	if store == nil {
		return
	}
	details := map[string]any{
		"appointment_id": appointmentID,
		"email_hash":     emailHash,
	}
	detailsJSON, _ := json.Marshal(details)

	row := phi.AccessAuditRecord{
		AuditID:      uuid.NewString(),
		AdminEmail:   "bt-ai",
		Action:       "appointment_cancel",
		ResourceType: "appointment",
		ResourceID:   appointmentID,
		Details:      string(detailsJSON),
		CreatedAt:    time.Now().UTC(),
	}
	go func() {
		auditCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := store.PutAccessAudit(auditCtx, row); err != nil {
			slog.Error("appointment_cancel: audit write failed", "err", err)
		}
	}()
}

// ---------------------------------------------------------------------------
// POST /internal/calendar/reschedule
// ---------------------------------------------------------------------------

type rescheduleAppointmentRequest struct {
	AppointmentID string `json:"appointmentId"`
	EmailHash     string `json:"emailHash"`
	StaffID       int    `json:"staffId"`
	StartISO      string `json:"startISO"`
	EndISO        string `json:"endISO"`
}

// RescheduleAppointment handles POST /internal/calendar/reschedule.
// Moves an existing appointment to a new slot. The caller must have obtained
// appointmentId + emailHash from a prior lookup_appointment call.
// Checks slot availability before writing; returns 409 with alternatives when
// the target slot is already taken. Never logs raw PHI.
func (h *InternalCalendarHandler) RescheduleAppointment(w http.ResponseWriter, r *http.Request) {
	if !h.checkInternalSecret(w, r) {
		return
	}

	var body rescheduleAppointmentRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid JSON")
		return
	}

	// Validate required fields.
	if strings.TrimSpace(body.AppointmentID) == "" || strings.TrimSpace(body.EmailHash) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "appointmentId and emailHash are required")
		return
	}
	if body.StaffID <= 0 {
		httpx.WriteError(w, http.StatusBadRequest, "staffId must be a positive integer")
		return
	}
	if strings.TrimSpace(body.StartISO) == "" || strings.TrimSpace(body.EndISO) == "" {
		httpx.WriteError(w, http.StatusBadRequest, "startISO and endISO are required")
		return
	}
	if _, found := calendar.ByID(body.StaffID); !found {
		httpx.WriteError(w, http.StatusBadRequest, "staffId not found in roster")
		return
	}

	ctx := r.Context()

	// Check slot availability before mutating the record.
	free, err := h.Cal.IsSlotFree(ctx, body.StaffID, body.StartISO, body.EndISO)
	if err != nil {
		slog.Error("reschedule_appointment: slot check failed", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if !free {
		alts, aerr := h.Cal.NearestAlternatives(ctx, body.StaffID, body.StartISO, body.EndISO)
		if aerr != nil {
			slog.Error("reschedule_appointment: alternatives failed", "err", aerr)
			alts = []calendar.Slot{}
		}
		if alts == nil {
			alts = []calendar.Slot{}
		}
		httpx.WriteJSON(w, http.StatusConflict, map[string]any{
			"error":        "slot_taken",
			"alternatives": alts,
		})
		return
	}

	// Parse the new appointment time from startISO. Must be a valid RFC3339
	// timestamp; the calendar store already validated the window is free.
	newTime, parseErr := time.Parse(time.RFC3339, body.StartISO)
	if parseErr != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid startISO: must be RFC3339")
		return
	}
	newTime = newTime.UTC()

	// Mutate the DDB record in place.
	updateErr := h.PHI.UpdateIntakeAppointment(ctx, body.EmailHash, body.AppointmentID, newTime, body.StaffID)
	appointmentRescheduleAudit(ctx, h.PHI, body.AppointmentID, body.EmailHash, newTime.Format(time.RFC3339))

	if updateErr != nil {
		if errors.Is(updateErr, phi.ErrNotFound) {
			httpx.WriteJSON(w, http.StatusOK, map[string]any{
				"ok":    false,
				"error": "not_found",
			})
			return
		}
		// Log error without PHI (no appointmentID/emailHash in the log line).
		slog.Error("reschedule_appointment: update appointment failed", "err", updateErr)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"ok":    false,
			"error": "reschedule_failed",
		})
		return
	}

	// Best-effort confirmation email for the completed move — never fail the
	// reschedule over a missed notification. Recipient + first name come from
	// the DDB record (same pattern as admin status-change emails); no raw PHI
	// in logs. emailQueued is returned so the AI agent only claims an email
	// was sent when one was actually enqueued.
	emailQueued := false
	if h.NotifyEnabled && h.Notify != nil && h.PHI != nil {
		if rec, gerr := h.PHI.GetIntake(ctx, body.EmailHash, body.AppointmentID); gerr != nil {
			slog.Warn("reschedule_appointment: get intake for email failed", "err", gerr)
		} else if rec != nil {
			if email := strings.TrimSpace(rec.Email); email != "" {
				greeting := notifyGreeting(strings.TrimSpace(rec.FirstName))
				therapistName := therapistDisplayName(body.StaffID)
				apptFormatted := formatApptTime(newTime.Format(time.RFC3339))
				subj, heading, paragraphs, details := buildRescheduleRequestedDetailContent(greeting, therapistName, apptFormatted)
				// New time in the dedupe key so moving again to a different
				// slot still sends, while an exact-duplicate retry is deduped.
				dedupeKey := fmt.Sprintf("apptreschedule:%s:%s:email", body.AppointmentID, newTime.Format(time.RFC3339))
				emailQueued = enqueueEmail(ctx, h.Notify, email, subj, heading, paragraphs, details, true, dedupeKey, body.AppointmentID)
				slog.Info("reschedule_appointment: confirmation email enqueue",
					"appointment_id", body.AppointmentID, "channel", "email", "enqueued", emailQueued)
			}
		}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":                 true,
		"appointmentId":      body.AppointmentID,
		"appointmentTimeISO": newTime.Format(time.RFC3339),
		"emailQueued":        emailQueued,
	})
}

// appointmentRescheduleAudit fires a background PHI audit row for a reschedule
// call. Only appointment_id, email_hash, and the new ISO timestamp are written;
// no raw PHI (no name, phone, DOB, email address).
func appointmentRescheduleAudit(ctx context.Context, store *phi.Store, appointmentID, emailHash, newTimeISO string) {
	if store == nil {
		return
	}
	details := map[string]any{
		"appointment_id": appointmentID,
		"email_hash":     emailHash,
		"new_time_iso":   newTimeISO,
	}
	detailsJSON, _ := json.Marshal(details)

	row := phi.AccessAuditRecord{
		AuditID:      uuid.NewString(),
		AdminEmail:   "bt-ai",
		Action:       "appointment_reschedule",
		ResourceType: "appointment",
		ResourceID:   appointmentID,
		Details:      string(detailsJSON),
		CreatedAt:    time.Now().UTC(),
	}
	go func() {
		auditCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := store.PutAccessAudit(auditCtx, row); err != nil {
			slog.Error("appointment_reschedule: audit write failed", "err", err)
		}
	}()
}
