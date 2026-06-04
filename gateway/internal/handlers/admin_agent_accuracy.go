package handlers

// admin_agent_accuracy.go — admin read + trigger endpoints for the Agent
// Accuracy eval system.
//
// All four routes are mounted inside the RequireSuperadmin group because:
//   - /runs/{runId} exposes full production transcripts (PHI).
//   - /summary and /runs expose model performance details that must not leak.
//   - /run (trigger) kicks off an eval that reads live chat history (PHI).
//
// Every handler that touches eval data calls admin.LogPHIAccess so access
// is traceable per HIPAA §164.312(b).

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/go-chi/chi/v5"
)

// AdminAgentAccuracyHandler serves the four admin eval endpoints.
type AdminAgentAccuracyHandler struct {
	PHI          *phi.Store
	AIServiceURL string
}

// ---------------------------------------------------------------------------
// JSON response shapes — snake_case throughout so the Next.js admin UI
// can consume them without a mapping layer.
// ---------------------------------------------------------------------------

type runSummaryJSON struct {
	RunID         string             `json:"run_id"`
	Kind          string             `json:"kind"`
	Model         string             `json:"model"`
	PromptVersion string             `json:"prompt_version"`
	CreatedAt     time.Time          `json:"created_at"`
	Counts        map[string]int     `json:"counts"`
	Metrics       map[string]float64 `json:"metrics"`
	// Breakdowns is emitted as raw JSON (any nested shape) so the frontend
	// receives exactly what the AI harness produced — no schema enforcement.
	Breakdowns any `json:"breakdowns"`
}

type turnDetailJSON struct {
	Seq            int       `json:"seq"`
	SessionID      string    `json:"session_id"`
	ConvoName      string    `json:"convo_name"`
	IsProduction   bool      `json:"is_production"`
	UserSays       string    `json:"user_says"`
	Reply          string    `json:"reply"`
	Scene          string    `json:"scene"`
	Intent         string    `json:"intent"`
	ExpectedIntent string    `json:"expected_intent"`
	Passed         bool      `json:"passed"`
	// DeterministicScores and Judge are raw decoded JSON; nil if not stored.
	DeterministicScores any `json:"deterministic_scores"`
	Judge               any `json:"judge"`
	LatencyMs           int `json:"latency_ms"`
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// runSummaryFromPHI converts a phi.EvalRun to the JSON response shape.
// breakdowns is decoded from the stored JSON string; errors are silently
// swallowed (the raw string is omitted rather than crashing the response).
func runSummaryFromPHI(r phi.EvalRun) runSummaryJSON {
	var breakdowns any
	if bd, err := r.BreakdownsDecoded(); err == nil {
		breakdowns = bd
	}
	return runSummaryJSON{
		RunID:         r.RunID,
		Kind:          r.Kind,
		Model:         r.Model,
		PromptVersion: r.PromptVersion,
		CreatedAt:     r.CreatedAt,
		Counts:        r.Counts,
		Metrics:       r.Metrics,
		Breakdowns:    breakdowns,
	}
}

// turnDetailFromPHI converts a phi.EvalTurn to the JSON response shape.
func turnDetailFromPHI(t phi.EvalTurn) turnDetailJSON {
	var detScores any
	if ds, err := t.DeterministicScoresDecoded(); err == nil {
		detScores = ds
	}
	var judge any
	if j, err := t.JudgeDecoded(); err == nil {
		judge = j
	}
	return turnDetailJSON{
		Seq:                 t.Seq,
		SessionID:           t.SessionID,
		ConvoName:           t.ConvoName,
		IsProduction:        t.IsProduction,
		UserSays:            t.UserSays,
		Reply:               t.Reply,
		Scene:               t.Scene,
		Intent:              t.Intent,
		ExpectedIntent:      t.ExpectedIntent,
		Passed:              t.Passed,
		DeterministicScores: detScores,
		Judge:               judge,
		LatencyMs:           t.LatencyMs,
	}
}

// ---------------------------------------------------------------------------
// GET /admin/api/agent-accuracy/summary
// ---------------------------------------------------------------------------

// Summary returns the latest run and the 30 most-recent runs for trend
// display.
func (h *AdminAgentAccuracyHandler) Summary(w http.ResponseWriter, r *http.Request) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "view_eval_summary", "eval_runs", "summary")

	runs, err := h.PHI.ListEvalRuns(r.Context(), 30)
	if err != nil {
		slog.Error("agent accuracy: list runs for summary", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	trend := make([]runSummaryJSON, 0, len(runs))
	for _, run := range runs {
		trend = append(trend, runSummaryFromPHI(run))
	}

	var latest *runSummaryJSON
	if len(trend) > 0 {
		first := trend[0]
		latest = &first
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"latest": latest,
		"trend":  trend,
	})
}

// ---------------------------------------------------------------------------
// GET /admin/api/agent-accuracy/runs?limit=
// ---------------------------------------------------------------------------

// ListRuns returns recent eval run summaries.
func (h *AdminAgentAccuracyHandler) ListRuns(w http.ResponseWriter, r *http.Request) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "list_eval_runs", "eval_runs", "list")

	limit := int32(30)
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.ParseInt(s, 10, 32); err == nil && n > 0 {
			if n > 100 {
				n = 100
			}
			limit = int32(n)
		}
	}

	runs, err := h.PHI.ListEvalRuns(r.Context(), limit)
	if err != nil {
		slog.Error("agent accuracy: list runs", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	summaries := make([]runSummaryJSON, 0, len(runs))
	for _, run := range runs {
		summaries = append(summaries, runSummaryFromPHI(run))
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"runs":  summaries,
		"count": len(summaries),
	})
}

// ---------------------------------------------------------------------------
// GET /admin/api/agent-accuracy/runs/{runId}
// ---------------------------------------------------------------------------

// GetRun returns the summary and all per-turn details for one eval run.
// This exposes full transcripts and is the highest-privilege endpoint.
func (h *AdminAgentAccuracyHandler) GetRun(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")
	if runID == "" {
		httpx.WriteValidationError(w, "runId is required")
		return
	}

	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	// Audit: transcripts are exposed — log with the specific run ID.
	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "view_eval_run", "eval_run", runID)

	run, err := h.PHI.GetEvalRun(r.Context(), runID)
	if err != nil {
		if errors.Is(err, phi.ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "eval run not found")
			return
		}
		slog.Error("agent accuracy: get run", "run_id", runID, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	turns, err := h.PHI.ListEvalTurns(r.Context(), runID, 1000)
	if err != nil {
		slog.Error("agent accuracy: list turns", "run_id", runID, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	turnDetails := make([]turnDetailJSON, 0, len(turns))
	for _, t := range turns {
		turnDetails = append(turnDetails, turnDetailFromPHI(t))
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"run":   runSummaryFromPHI(*run),
		"turns": turnDetails,
	})
}

// ---------------------------------------------------------------------------
// POST /admin/api/agent-accuracy/run
// ---------------------------------------------------------------------------

type triggerEvalRequest struct {
	Kind   string `json:"kind"`
	Sample *int   `json:"sample,omitempty"`
}

// TriggerRun forwards a trigger request to the AI service and returns its
// response. Uses a 10 s timeout — the AI side returns immediately with a
// run_id, the actual eval runs async.
func (h *AdminAgentAccuracyHandler) TriggerRun(w http.ResponseWriter, r *http.Request) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "trigger_eval_run", "eval_runs", "trigger")

	var req triggerEvalRequest
	if err := httpx.ReadJSON(w, r, &req); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if req.Kind != "offline" && req.Kind != "online" {
		httpx.WriteValidationError(w, "kind must be 'offline' or 'online'")
		return
	}
	if h.AIServiceURL == "" {
		httpx.WriteError(w, http.StatusInternalServerError, "ai service not configured")
		return
	}

	body, err := json.Marshal(req)
	if err != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	aiURL := h.AIServiceURL + "/internal/evals/trigger"
	httpClient := &http.Client{Timeout: 10 * time.Second}
	aiResp, err := httpClient.Post(aiURL, "application/json", bytes.NewReader(body)) //nolint:noctx
	if err != nil {
		slog.Error("agent accuracy: trigger eval", "err", err)
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("ai service error: %v", err))
		return
	}
	defer aiResp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(aiResp.Body, 64*1024))
	if err != nil {
		slog.Error("agent accuracy: read trigger response", "err", err)
		httpx.WriteError(w, http.StatusBadGateway, "failed to read ai response")
		return
	}

	// Pass the AI response status + body through verbatim (the AI returns
	// {run_id, status} on 200, or an error object on failure).
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(aiResp.StatusCode)
	_, _ = w.Write(respBody)
}
