package handlers

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/calendar"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminCalendarStore is the interface the admin calendar handler requires.
// Defined by this consumer so the calendar package doesn't have to export
// a fat interface.
type AdminCalendarStore interface {
	ListEvents(ctx context.Context, staffID int, fromISO, toISO string) ([]calendar.JaneEvent, error)
	ListActiveHolds(ctx context.Context, staffID int) ([]calendar.SoftHold, error)
	GetEventByPKSK(ctx context.Context, pk, sk string) (*calendar.JaneEvent, error)
}

// AdminCalendarHandler serves the Cognito-gated admin calendar endpoints.
// Every handler writes an audit row for HIPAA §164.312(b).
type AdminCalendarHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store
	Cal  AdminCalendarStore
}

// Therapists handles GET /admin/api/calendar/therapists.
// Returns the full 10-therapist roster. No PHI involved.
// Audit action: view_calendar_therapists.
func (h *AdminCalendarHandler) Therapists(w http.ResponseWriter, r *http.Request) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	// No patient PHI — use a stable synthetic resource ID so the audit row
	// is still written (§164.312(b) requires logging all accesses).
	admin.LogPHIAccess(r.Context(), h.PHI, r, u,
		"view_calendar_therapists", "calendar_therapists", "all")

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"therapists": calendar.Roster,
	})
}

// Events handles GET /admin/api/calendar/events?from=<ISO>&to=<ISO>&staffId=<id?>
// Merges jane-events with active soft-holds. Description (PHI) is NEVER returned.
// Audit action: view_calendar_events.
func (h *AdminCalendarHandler) Events(w http.ResponseWriter, r *http.Request) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	from := strings.TrimSpace(r.URL.Query().Get("from"))
	to := strings.TrimSpace(r.URL.Query().Get("to"))
	if from == "" || to == "" {
		httpx.WriteValidationError(w, "from and to are required")
		return
	}
	fromT, err := time.Parse(time.RFC3339, from)
	if err != nil {
		httpx.WriteValidationError(w, "from must be UTC ISO 8601 (e.g. 2024-01-15T00:00:00Z)")
		return
	}
	toT, err := time.Parse(time.RFC3339, to)
	if err != nil {
		httpx.WriteValidationError(w, "to must be UTC ISO 8601 (e.g. 2024-01-15T23:59:59Z)")
		return
	}
	if !toT.After(fromT) {
		httpx.WriteValidationError(w, "to must be after from")
		return
	}
	if toT.Sub(fromT) > 62*24*time.Hour {
		httpx.WriteValidationError(w, "date range must not exceed 62 days")
		return
	}

	staffID := 0
	if s := strings.TrimSpace(r.URL.Query().Get("staffId")); s != "" {
		id, aerr := strconv.Atoi(s)
		if aerr != nil || id <= 0 {
			httpx.WriteValidationError(w, "staffId must be a positive integer")
			return
		}
		if _, found := calendar.ByID(id); !found {
			httpx.WriteValidationError(w, "staffId not found in roster")
			return
		}
		staffID = id
	}

	events, err := h.Cal.ListEvents(r.Context(), staffID, from, to)
	if err != nil {
		slog.Error("admin calendar events: list", "err", err, "staff_id", staffID)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// Gather active soft-holds for the relevant staff IDs. Errors are
	// non-fatal (we still return events even if holds are unavailable).
	holdsByStaff := make(map[int][]calendar.SoftHold)
	for _, sid := range calendarStaffIDs(staffID) {
		holds, herr := h.Cal.ListActiveHolds(r.Context(), sid)
		if herr != nil {
			slog.Error("admin calendar events: list holds", "err", herr, "staff_id", sid)
			continue
		}
		holdsByStaff[sid] = holds
	}

	type eventListItem struct {
		ID         string `json:"id"`
		StaffID    int    `json:"staffId"`
		Type       string `json:"type"`
		StartISO   string `json:"startISO"`
		EndISO     string `json:"endISO"`
		Summary    string `json:"summary"`
		Status     string `json:"status"`
		HasDetails bool   `json:"hasDetails"`
	}

	out := make([]eventListItem, 0, len(events))
	resourceIDs := make([]string, 0, len(events))

	for _, e := range events {
		// Encode "pk|sk" as base64url for a URL-safe eventId.
		pk := "staff#" + strconv.Itoa(e.StaffID)
		sk := e.Type + "#" + e.StartISO + "#" + e.UID
		encoded := base64.RawURLEncoding.EncodeToString([]byte(pk + "|" + sk))
		out = append(out, eventListItem{
			ID:         encoded,
			StaffID:    e.StaffID,
			Type:       e.Type,
			StartISO:   e.StartISO,
			EndISO:     e.EndISO,
			Summary:    e.Summary,
			Status:     e.Status,
			HasDetails: e.Description != "", // presence only — not the content
		})
		resourceIDs = append(resourceIDs, encoded)
	}

	// Merge active soft-holds as synthetic type:"hold" events.
	nowUnix := time.Now().Unix()
	for sid, holds := range holdsByStaff {
		for _, hold := range holds {
			if hold.ExpiresAt <= nowUnix {
				continue
			}
			pk := "staff#" + strconv.Itoa(sid)
			sk := "hold#" + hold.HoldID
			encoded := base64.RawURLEncoding.EncodeToString([]byte(pk + "|" + sk))
			out = append(out, eventListItem{
				ID:         encoded,
				StaffID:    sid,
				Type:       "hold",
				StartISO:   hold.StartISO,
				EndISO:     hold.EndISO,
				Summary:    "Pending confirmation",
				Status:     "pending",
				HasDetails: false,
			})
		}
	}

	// Audit: ONE row per calendar view, not one per event. The list response
	// carries only metadata (summary/status/presence-of-details) — never the
	// PHI description, which is read (and audited per-event) by EventDetails.
	// Logging every visible event id here flooded the audit trail with
	// thousands of identical-timestamp rows per browse; the range + staff
	// filter + count (all non-PHI) capture the access precisely and let the
	// visible event set be reconstructed from the calendar at that time.
	staffFilter := "all"
	if staffID > 0 {
		staffFilter = strconv.Itoa(staffID)
	}
	auditScope := fmt.Sprintf("from=%s;to=%s;staff=%s;events=%d", from, to, staffFilter, len(resourceIDs))
	admin.LogPHIAccess(r.Context(), h.PHI, r, u,
		"view_calendar_events", "calendar_events", auditScope)

	slog.Info("admin calendar events",
		"staff_id", staffID,
		"from", from,
		"to", to,
		"event_count", len(out),
	)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"events": out})
}

// EventDetails handles GET /admin/api/calendar/events/{eventId}/details.
// Returns the description field (PHI). Audited with the eventId; the
// description content is NEVER logged.
// Audit action: view_calendar_event_details.
func (h *AdminCalendarHandler) EventDetails(w http.ResponseWriter, r *http.Request) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}

	eventID := chi.URLParam(r, "eventId")
	if eventID == "" {
		httpx.WriteValidationError(w, "eventId is required")
		return
	}

	// Decode base64url → "pk|sk"
	raw, derr := base64.RawURLEncoding.DecodeString(eventID)
	if derr != nil {
		httpx.WriteValidationError(w, "invalid eventId encoding")
		return
	}
	parts := strings.SplitN(string(raw), "|", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		httpx.WriteValidationError(w, "malformed eventId")
		return
	}
	pk, sk := parts[0], parts[1]

	// Soft-holds have no description; return empty gracefully.
	if strings.HasPrefix(sk, "hold#") {
		admin.LogPHIAccess(r.Context(), h.PHI, r, u,
			"view_calendar_event_details", "calendar_event_phi", eventID)
		httpx.WriteJSON(w, http.StatusOK, map[string]string{"description": ""})
		return
	}

	evt, err := h.Cal.GetEventByPKSK(r.Context(), pk, sk)
	if err != nil {
		if errors.Is(err, calendar.ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "event not found")
			return
		}
		slog.Error("admin calendar event details: get", "err", err, "event_id", eventID)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	// HIPAA §164.312(b): log the eventId, NOT the description content.
	admin.LogPHIAccess(r.Context(), h.PHI, r, u,
		"view_calendar_event_details", "calendar_event_phi", eventID)

	slog.Info("admin calendar event detail accessed", "event_id", eventID)

	httpx.WriteJSON(w, http.StatusOK, map[string]string{"description": evt.Description})
}

// calendarStaffIDs returns the staff IDs to query. If staffID is 0, returns
// all feed-connected therapist IDs (the only ones with jane-events).
func calendarStaffIDs(staffID int) []int {
	if staffID != 0 {
		return []int{staffID}
	}
	ids := make([]int, 0, 6)
	for _, t := range calendar.Roster {
		if t.FeedConnected {
			ids = append(ids, t.StaffID)
		}
	}
	return ids
}
