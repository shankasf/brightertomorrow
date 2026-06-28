// match_therapists.go — therapist-match quiz endpoints.
//
// Public routes (rate-limited per IP):
//
//	GET  /v1/match/options        → quiz config (questions, intro copy)
//	POST /v1/match/therapists     → run match, record MatchEvent
//	POST /v1/match/picked         → record clinician pick-through (fire-and-forget)
//
// Internal routes (cluster-only, for AI service):
//
//	GET  /internal/match/options
//	POST /internal/match/therapists
//
// No PHI: match answers (type/modality/location/insurance) and analytics
// counts are non-PHI. Patient identity only enters downstream at the
// existing insurance-check / booking step.
package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/match"
	"github.com/google/uuid"
)

// MatchTherapistHandler serves the quiz options + therapist-match endpoints.
// All three store interfaces are required.
type MatchTherapistHandler struct {
	Clinicians match.ClinicianStore
	Config     match.MatchConfigStore
	Events     match.MatchEventStore
}

// ─── GET /v1/match/options  (also /internal/match/options) ─────────────────

// Options returns the quiz config. Falls back to DefaultConfig if DDB has no
// config yet, so the app never hard-fails on a missing record.
func (h *MatchTherapistHandler) Options(w http.ResponseWriter, r *http.Request) {
	cfg, err := h.Config.GetMatchConfig(r.Context())
	if err != nil {
		if !errors.Is(err, match.ErrNotFound) {
			slog.Error("match/options: get config", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		// No config seeded yet — return built-in default.
		def := match.DefaultConfig
		cfg = &def
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":     true,
		"config": cfg,
	})
}

// ─── POST /v1/match/therapists  (also /internal/match/therapists) ───────────

type matchTherapistsReq struct {
	Channel string             `json:"channel"`
	Answers match.MatchAnswers `json:"answers"`
}

type matchTherapistsResp struct {
	OK          bool           `json:"ok"`
	MatchUUID   string         `json:"match_uuid"`
	ResultCount int            `json:"result_count"`
	Results     []match.Result `json:"results"`
}

// Therapists runs the match algorithm and records a MatchEvent.
func (h *MatchTherapistHandler) Therapists(w http.ResponseWriter, r *http.Request) {
	var body matchTherapistsReq
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}

	channel := body.Channel
	if channel == "" {
		channel = "web"
	}

	cfg, err := h.Config.GetMatchConfig(r.Context())
	if err != nil && !errors.Is(err, match.ErrNotFound) {
		slog.Error("match/therapists: get config", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if cfg == nil {
		def := match.DefaultConfig
		cfg = &def
	}

	clinicians, err := h.Clinicians.ListClinicians(r.Context(), true)
	if err != nil {
		slog.Error("match/therapists: list clinicians", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	results := match.Match(body.Answers, clinicians, cfg)

	matchUUID := uuid.NewString()
	now := time.Now().UTC()
	event := match.MatchEvent{
		ID:          matchUUID,
		CreatedAt:   now,
		Channel:     channel,
		Answers:     body.Answers,
		ResultCount: len(results),
		RetainUntil: now.AddDate(2, 0, 0), // 2-year retention per contract
	}
	// Fire-and-forget: record the analytics event asynchronously so a
	// DDB hiccup never degrades the user-facing response.
	// Use context.Background(): request context is cancelled when handler returns.
	go func() {
		bgCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := h.Events.PutMatchEvent(bgCtx, event); err != nil {
			slog.Warn("match/therapists: record event", "match_uuid", matchUUID, "err", err)
		}
	}()

	httpx.WriteJSON(w, http.StatusOK, matchTherapistsResp{
		OK:          true,
		MatchUUID:   matchUUID,
		ResultCount: len(results),
		Results:     results,
	})
}

// ─── POST /v1/match/picked ──────────────────────────────────────────────────

type matchPickedReq struct {
	MatchUUID  string `json:"match_uuid"`
	PickedSlug string `json:"picked_slug"`
}

// Picked records which clinician the visitor selected after seeing results.
// Fire-and-forget from the client's perspective; we return 200 even on store
// errors to avoid blocking the user's booking flow.
func (h *MatchTherapistHandler) Picked(w http.ResponseWriter, r *http.Request) {
	var body matchPickedReq
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if body.MatchUUID == "" || body.PickedSlug == "" {
		httpx.WriteValidationError(w, "match_uuid and picked_slug are required")
		return
	}

	matchUUID := body.MatchUUID
	pickedSlug := body.PickedSlug
	go func() {
		bgCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		err := h.Events.UpdateMatchEventPick(bgCtx, matchUUID, pickedSlug)
		if err != nil && !errors.Is(err, match.ErrNotFound) {
			slog.Warn("match/picked: update event",
				"match_uuid", matchUUID,
				"picked_slug", pickedSlug,
				"err", err,
			)
		}
	}()

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}
