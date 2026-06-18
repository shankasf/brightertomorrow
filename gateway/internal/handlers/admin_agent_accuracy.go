package handlers

// admin_agent_accuracy.go — admin read + trigger endpoints for the Agent
// Accuracy eval system.
//
// All routes are mounted inside the RequireSuperadmin group because:
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
	"math"
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
	RunID          string             `json:"run_id"`
	Kind           string             `json:"kind"`
	Channel        string             `json:"channel"` // "chat" | "voice" | "phone" (legacy empty → chat)
	Model          string             `json:"model"`
	PromptVersion  string             `json:"prompt_version"`
	DatasetVersion string             `json:"dataset_version"`
	CreatedAt      time.Time          `json:"created_at"`
	Counts         map[string]int     `json:"counts"`
	MetricCounts   map[string]int     `json:"metric_counts"`
	Metrics        map[string]float64 `json:"metrics"`
	// Breakdowns is emitted as raw JSON (any nested shape) so the frontend
	// receives exactly what the AI harness produced — no schema enforcement.
	Breakdowns any `json:"breakdowns"`
	// Regression is the decoded regression-vs-baseline verdict object; nil if
	// not stored (old runs or runs without a baseline comparison).
	Regression any `json:"regression"`
}

type turnDetailJSON struct {
	Seq            int    `json:"seq"`
	SessionID      string `json:"session_id"`
	ConvoName      string `json:"convo_name"`
	IsProduction   bool   `json:"is_production"`
	UserSays       string `json:"user_says"`
	Reply          string `json:"reply"`
	Scene          string `json:"scene"`
	Split          string `json:"split"`
	Intent         string `json:"intent"`
	ExpectedIntent string `json:"expected_intent"`
	Passed         bool   `json:"passed"`
	// DeterministicScores and Judge are raw decoded JSON; nil if not stored.
	DeterministicScores any `json:"deterministic_scores"`
	Judge               any `json:"judge"`
	LatencyMs           int `json:"latency_ms"`
	// HumanLabel is the reviewer's label for this turn; null if unlabeled.
	HumanLabel *humanLabelJSON `json:"human_label"`
}

// humanLabelJSON is the JSON shape for one human eval label.
type humanLabelJSON struct {
	Verdict                 string    `json:"verdict"`
	CorrectedIntent         string    `json:"corrected_intent,omitempty"`
	CorrectedTaskCompletion *bool     `json:"corrected_task_completion,omitempty"`
	CorrectedTopicAdherence *bool     `json:"corrected_topic_adherence,omitempty"`
	Note                    string    `json:"note,omitempty"`
	LabeledBy               string    `json:"labeled_by"`
	LabeledAt               time.Time `json:"labeled_at"`
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
	var regression any
	if reg, err := r.RegressionDecoded(); err == nil {
		regression = reg
	}
	channel := r.Channel
	if channel == "" {
		channel = "chat" // legacy rows predate the channel split
	}
	return runSummaryJSON{
		RunID:          r.RunID,
		Kind:           r.Kind,
		Channel:        channel,
		Model:          r.Model,
		PromptVersion:  r.PromptVersion,
		DatasetVersion: r.DatasetVersion,
		CreatedAt:      r.CreatedAt,
		Counts:         r.Counts,
		MetricCounts:   r.MetricCounts,
		Metrics:        r.Metrics,
		Breakdowns:     breakdowns,
		Regression:     regression,
	}
}

// turnDetailFromPHI converts a phi.EvalTurn (and optional human label) to
// the JSON response shape.
func turnDetailFromPHI(t phi.EvalTurn, label *phi.EvalHumanLabel) turnDetailJSON {
	var detScores any
	if ds, err := t.DeterministicScoresDecoded(); err == nil {
		detScores = ds
	}
	var judge any
	if j, err := t.JudgeDecoded(); err == nil {
		judge = j
	}
	var hl *humanLabelJSON
	if label != nil {
		hl = &humanLabelJSON{
			Verdict:                 label.Verdict,
			CorrectedIntent:         label.CorrectedIntent,
			CorrectedTaskCompletion: label.CorrectedTaskCompletion,
			CorrectedTopicAdherence: label.CorrectedTopicAdherence,
			Note:                    label.Note,
			LabeledBy:               label.LabeledBy,
			LabeledAt:               label.LabeledAt,
		}
	}
	return turnDetailJSON{
		Seq:                 t.Seq,
		SessionID:           t.SessionID,
		ConvoName:           t.ConvoName,
		IsProduction:        t.IsProduction,
		UserSays:            t.UserSays,
		Reply:               t.Reply,
		Scene:               t.Scene,
		Split:               t.Split,
		Intent:              t.Intent,
		ExpectedIntent:      t.ExpectedIntent,
		Passed:              t.Passed,
		DeterministicScores: detScores,
		Judge:               judge,
		LatencyMs:           t.LatencyMs,
		HumanLabel:          hl,
	}
}

// ---------------------------------------------------------------------------
// Cohen's kappa — judge vs human agreement on task_completion (pure Go, no LLM)
// ---------------------------------------------------------------------------

// kappaMinLabels is the minimum number of labeled turns required before we
// compute and expose kappa. Below this, the estimate is too noisy to be useful.
const kappaMinLabels = 5

// judgeHumanKappaResult holds the outputs of computeJudgeHumanKappa.
type judgeHumanKappaResult struct {
	Kappa        *float64 // nil when fewer than kappaMinLabels turns are labeled
	LabeledCount int
}

// computeJudgeHumanKappa computes Cohen's kappa over turns that have both a
// judge score and a human label, using `task_completion` as the boolean
// dimension.
//
// For each labeled turn:
//   - judgeValue: extracted from JudgeJSON["task_completion"] as bool. Turns
//     whose judge JSON is missing or does not contain a bool task_completion are
//     skipped (no contribution to labeled count).
//   - humanValue: if verdict == "agree", use judgeValue (the reviewer confirms
//     the judge); if verdict == "disagree" AND corrected_task_completion is set,
//     use that; otherwise skip the turn.
//
// Cohen's kappa = (p_o - p_e) / (1 - p_e)
// where p_o is observed agreement and p_e is expected agreement by chance.
// Returns nil kappa when fewer than kappaMinLabels valid labeled turns exist.
func computeJudgeHumanKappa(turns []phi.EvalTurn, labels map[int]*phi.EvalHumanLabel) judgeHumanKappaResult {
	// Contingency counts: a=both true, b=judge true human false,
	// c=judge false human true, d=both false.
	var a, b, c, d float64
	labeled := 0

	for _, t := range turns {
		lbl, ok := labels[t.Seq]
		if !ok {
			continue
		}
		// Extract judge task_completion.
		judgeMap, err := t.JudgeDecoded()
		if err != nil || judgeMap == nil {
			continue
		}
		rawTC, ok := judgeMap["task_completion"]
		if !ok {
			continue
		}
		judgeTC, ok := rawTC.(bool)
		if !ok {
			// Sometimes judges emit 1/0 as float64.
			if fv, ok2 := rawTC.(float64); ok2 {
				judgeTC = fv != 0
			} else {
				continue
			}
		}

		// Resolve human value.
		var humanTC bool
		switch lbl.Verdict {
		case "agree":
			humanTC = judgeTC
		case "disagree":
			if lbl.CorrectedTaskCompletion == nil {
				continue // can't determine human value
			}
			humanTC = *lbl.CorrectedTaskCompletion
		default:
			continue
		}

		labeled++
		switch {
		case judgeTC && humanTC:
			a++
		case judgeTC && !humanTC:
			b++
		case !judgeTC && humanTC:
			c++
		default:
			d++
		}
	}

	res := judgeHumanKappaResult{LabeledCount: labeled}
	if labeled < kappaMinLabels {
		return res
	}

	n := a + b + c + d
	if n == 0 {
		return res
	}
	pO := (a + d) / n
	pE := ((a+b)*(a+c) + (c+d)*(b+d)) / (n * n)
	denom := 1 - pE
	var kappa float64
	if math.Abs(denom) < 1e-12 {
		kappa = 1.0 // perfect agreement, no chance disagreement
	} else {
		kappa = (pO - pE) / denom
	}
	// Round to 4 decimal places to avoid floating-point noise in JSON.
	kappa = math.Round(kappa*10000) / 10000
	res.Kappa = &kappa
	return res
}

// ---------------------------------------------------------------------------
// GET /admin/api/agent-accuracy/summary
// ---------------------------------------------------------------------------

// Summary returns the latest run and the 30 most-recent runs for trend
// display, plus judge–human kappa and escalation false-positive rate.
func (h *AdminAgentAccuracyHandler) Summary(w http.ResponseWriter, r *http.Request) {
	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "view_eval_summary", "eval_runs", "summary")

	// Channel scope (default chat). Runs share one DDB partition, so we
	// over-fetch then filter in Go and keep the newest 30 of this channel.
	channel := r.URL.Query().Get("channel")
	if channel == "" {
		channel = "chat"
	}
	if channel != "chat" && channel != "voice" && channel != "phone" {
		httpx.WriteValidationError(w, "channel must be 'chat', 'voice', or 'phone'")
		return
	}

	runs, err := h.PHI.ListEvalRuns(r.Context(), 100)
	if err != nil {
		slog.Error("agent accuracy: list runs for summary", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	const trendCap = 30
	trend := make([]runSummaryJSON, 0, trendCap)
	for _, run := range runs {
		s := runSummaryFromPHI(run) // Channel already defaulted to chat here
		if s.Channel != channel {
			continue
		}
		trend = append(trend, s)
		if len(trend) >= trendCap {
			break
		}
	}

	var latest *runSummaryJSON
	if len(trend) > 0 {
		first := trend[0]
		latest = &first
	}

	// --- Judge–human kappa over the latest run for this channel ---
	var kappaVal *float64
	kappaLabeledCount := 0
	if latest != nil {
		turns, tErr := h.PHI.ListEvalTurns(r.Context(), latest.RunID, 1000)
		if tErr != nil {
			slog.Warn("agent accuracy: list turns for kappa", "run_id", latest.RunID, "err", tErr)
		} else {
			labelsMap, lErr := h.PHI.ListEvalHumanLabels(r.Context(), latest.RunID)
			if lErr != nil {
				slog.Warn("agent accuracy: list human labels for kappa", "run_id", latest.RunID, "err", lErr)
			} else {
				kr := computeJudgeHumanKappa(turns, labelsMap)
				kappaVal = kr.Kappa
				kappaLabeledCount = kr.LabeledCount
			}
		}
	}

	// --- Escalation false-positive rate over callbacks from the last 30 days ---
	// We over-fetch recent callbacks (up to 500) and batch-fetch their verdicts.
	// Only callbacks that have a verdict contribute to the rate.
	escalationFPRate, escalationReviewedCount := h.escalationMetrics(r)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"latest":                         latest,
		"trend":                          trend,
		"judge_human_kappa":              kappaVal,
		"judge_human_labeled_count":      kappaLabeledCount,
		"escalation_false_positive_rate": escalationFPRate,
		"escalation_reviewed_count":      escalationReviewedCount,
	})
}

// escalationMetrics computes the escalation false-positive rate over recent
// callbacks (last 30 days, up to 500 items). Returns (falsePositiveRate,
// reviewedCount). Both are 0/nil-safe.
func (h *AdminAgentAccuracyHandler) escalationMetrics(r *http.Request) (*float64, int) {
	if h.PHI == nil {
		return nil, 0
	}
	callbacks, _, err := h.PHI.ListCallbacks(r.Context(), phi.CallbackFilter{Limit: 500})
	if err != nil {
		slog.Warn("agent accuracy: list callbacks for escalation metrics", "err", err)
		return nil, 0
	}

	// Filter to last 30 days and collect IDs.
	cutoff := time.Now().UTC().AddDate(0, 0, -30)
	ids := make([]string, 0, len(callbacks))
	for _, cb := range callbacks {
		if cb.CreatedAt.After(cutoff) {
			ids = append(ids, cb.CallbackID)
		}
	}
	if len(ids) == 0 {
		return nil, 0
	}

	verdicts, err := h.PHI.BatchGetEscalationVerdicts(r.Context(), ids)
	if err != nil {
		slog.Warn("agent accuracy: batch get verdicts for escalation metrics", "err", err)
		return nil, 0
	}

	reviewed := len(verdicts)
	if reviewed == 0 {
		return nil, 0
	}

	falsePositives := 0
	for _, v := range verdicts {
		if !v.Appropriate {
			falsePositives++
		}
	}
	rate := float64(falsePositives) / float64(reviewed)
	rate = math.Round(rate*10000) / 10000
	return &rate, reviewed
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

// GetRun returns the summary and all per-turn details for one eval run,
// with human labels merged onto each turn and kappa computed for this run.
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

	// Fetch human labels and merge onto turns.
	labelsMap, lErr := h.PHI.ListEvalHumanLabels(r.Context(), runID)
	if lErr != nil {
		slog.Warn("agent accuracy: list human labels", "run_id", runID, "err", lErr)
		labelsMap = map[int]*phi.EvalHumanLabel{} // non-fatal; turns render without labels
	}

	turnDetails := make([]turnDetailJSON, 0, len(turns))
	for _, t := range turns {
		turnDetails = append(turnDetails, turnDetailFromPHI(t, labelsMap[t.Seq]))
	}

	// Compute kappa for this specific run.
	kr := computeJudgeHumanKappa(turns, labelsMap)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"run":                       runSummaryFromPHI(*run),
		"turns":                     turnDetails,
		"judge_human_kappa":         kr.Kappa,
		"judge_human_labeled_count": kr.LabeledCount,
	})
}

// ---------------------------------------------------------------------------
// POST /admin/api/agent-accuracy/runs/{runId}/turns/{seq}/label
// ---------------------------------------------------------------------------

type labelTurnRequest struct {
	Verdict                 string `json:"verdict"`                    // "agree" | "disagree"
	CorrectedIntent         string `json:"corrected_intent,omitempty"` // optional, disagree only
	CorrectedTaskCompletion *bool  `json:"corrected_task_completion,omitempty"`
	CorrectedTopicAdherence *bool  `json:"corrected_topic_adherence,omitempty"`
	Note                    string `json:"note,omitempty"` // max 500 chars; no PHI
}

// LabelTurn upserts a human label for one eval turn.
func (h *AdminAgentAccuracyHandler) LabelTurn(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")
	seqStr := chi.URLParam(r, "seq")
	if runID == "" || seqStr == "" {
		httpx.WriteValidationError(w, "runId and seq are required")
		return
	}
	seq, err := strconv.Atoi(seqStr)
	if err != nil || seq < 0 {
		httpx.WriteValidationError(w, "seq must be a non-negative integer")
		return
	}

	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "label_eval_turn", "eval_run", runID)

	var req labelTurnRequest
	if err := httpx.ReadJSON(w, r, &req); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if req.Verdict != "agree" && req.Verdict != "disagree" {
		httpx.WriteValidationError(w, "verdict must be 'agree' or 'disagree'")
		return
	}
	if len(req.Note) > 500 {
		httpx.WriteValidationError(w, "note must be 500 characters or fewer")
		return
	}

	label := phi.EvalHumanLabel{
		RunID:                   runID,
		Seq:                     seq,
		Verdict:                 req.Verdict,
		CorrectedIntent:         req.CorrectedIntent,
		CorrectedTaskCompletion: req.CorrectedTaskCompletion,
		CorrectedTopicAdherence: req.CorrectedTopicAdherence,
		Note:                    req.Note,
		LabeledBy:               u.Email,
		LabeledAt:               time.Now().UTC(),
	}

	if err := h.PHI.PutEvalHumanLabel(r.Context(), label); err != nil {
		slog.Error("agent accuracy: put human label", "run_id", runID, "seq", seq, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// ---------------------------------------------------------------------------
// POST /admin/api/agent-accuracy/runs/{runId}/turns/{seq}/promote
// ---------------------------------------------------------------------------

// PromoteTurn calls the AI service to scrub and de-identify the turn's
// transcript, returning the fixture JSON directly to the caller. Nothing is
// persisted here — the reviewer copies the output into datasets.py manually.
func (h *AdminAgentAccuracyHandler) PromoteTurn(w http.ResponseWriter, r *http.Request) {
	runID := chi.URLParam(r, "runId")
	seqStr := chi.URLParam(r, "seq")
	if runID == "" || seqStr == "" {
		httpx.WriteValidationError(w, "runId and seq are required")
		return
	}
	seq, err := strconv.Atoi(seqStr)
	if err != nil || seq < 0 {
		httpx.WriteValidationError(w, "seq must be a non-negative integer")
		return
	}

	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "promote_eval_turn", "eval_run", runID)

	if h.AIServiceURL == "" {
		httpx.WriteError(w, http.StatusInternalServerError, "ai service not configured")
		return
	}

	// Fetch the turn so we can send its transcript.
	turns, tErr := h.PHI.ListEvalTurns(r.Context(), runID, 1000)
	if tErr != nil {
		slog.Error("agent accuracy: list turns for promote", "run_id", runID, "err", tErr)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	var target *phi.EvalTurn
	for i := range turns {
		if turns[i].Seq == seq {
			target = &turns[i]
			break
		}
	}
	if target == nil {
		httpx.WriteError(w, http.StatusNotFound, "turn not found")
		return
	}

	// Build payload for the AI scrub endpoint.
	payload := map[string]any{
		"run_id":     runID,
		"seq":        seq,
		"user_says":  target.UserSays,
		"reply":      target.Reply,
		"intent":     target.Intent,
		"scene":      target.Scene,
		"convo_name": target.ConvoName,
	}
	body, mErr := json.Marshal(payload)
	if mErr != nil {
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	aiURL := h.AIServiceURL + "/internal/evals/promote"
	httpClient := &http.Client{Timeout: 30 * time.Second}
	aiResp, rErr := httpClient.Post(aiURL, "application/json", bytes.NewReader(body)) //nolint:noctx
	if rErr != nil {
		slog.Error("agent accuracy: promote eval turn", "err", rErr)
		httpx.WriteError(w, http.StatusBadGateway, fmt.Sprintf("ai service error: %v", rErr))
		return
	}
	defer aiResp.Body.Close()

	respBody, rErr := io.ReadAll(io.LimitReader(aiResp.Body, 64*1024))
	if rErr != nil {
		slog.Error("agent accuracy: read promote response", "err", rErr)
		httpx.WriteError(w, http.StatusBadGateway, "failed to read ai response")
		return
	}

	// Pass the AI response through verbatim.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(aiResp.StatusCode)
	_, _ = w.Write(respBody)
}

// ---------------------------------------------------------------------------
// POST /admin/api/agent-accuracy/run
// ---------------------------------------------------------------------------

type triggerEvalRequest struct {
	Kind    string `json:"kind"`
	Channel string `json:"channel,omitempty"` // chat | voice | phone (default chat)
	Sample  *int   `json:"sample,omitempty"`
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
	if req.Channel == "" {
		req.Channel = "chat"
	}
	if req.Channel != "chat" && req.Channel != "voice" && req.Channel != "phone" {
		httpx.WriteValidationError(w, "channel must be 'chat', 'voice', or 'phone'")
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
