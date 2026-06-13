package handlers

// internal_evals.go — ingest endpoint for Agent Accuracy eval runs.
//
// POST /internal/evals/run — called by the bt-ai pod after each offline or
// online eval sweep. The payload includes a run summary + per-turn details.
// Both are persisted to DynamoDB via phi.Store so they never touch Hostinger
// Postgres (HIPAA boundary: transcripts + LLM judge rationale = PHI).
//
// GET /internal/chat/recent — returns recent chat-session metadata from
// Postgres (non-PHI pointer rows). Used by the AI eval harness to discover
// sessions to sample for online evals.

import (
	"encoding/json"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InternalEvalsHandler serves the eval ingest endpoint. No admin auth —
// internal-network boundary is the auth boundary (same pattern as
// ChatInternalHandler). PHI must be non-nil.
type InternalEvalsHandler struct {
	PHI  *phi.Store
	Pool *pgxpool.Pool
}

// evalRunPayload is the exact ingest contract sent by the AI harness.
// DisallowUnknownFields is NOT used here because the payload's breakdowns /
// judge / deterministic_scores sub-objects are arbitrary — we capture them
// verbatim via json.RawMessage and store as JSON strings.
type evalRunPayload struct {
	RunID          string             `json:"run_id"`
	Kind           string             `json:"kind"`
	Channel        string             `json:"channel"` // "chat" | "voice" | "phone"; empty → chat
	Model          string             `json:"model"`
	PromptVersion  string             `json:"prompt_version"`
	DatasetVersion string             `json:"dataset_version"`
	CreatedAt      time.Time          `json:"created_at"`
	Counts         map[string]int     `json:"counts"`
	MetricCounts   map[string]int     `json:"metric_counts"`
	Metrics        map[string]float64 `json:"metrics"`
	Breakdowns     json.RawMessage    `json:"breakdowns"`
	Regression     json.RawMessage    `json:"regression"`
	Turns          []evalTurnPayload  `json:"turns"`
}

type evalTurnPayload struct {
	Seq                 int             `json:"seq"`
	SessionID           string          `json:"session_id"`
	ConvoName           string          `json:"convo_name"`
	IsProduction        bool            `json:"is_production"`
	UserSays            string          `json:"user_says"`
	Reply               string          `json:"reply"`
	Scene               string          `json:"scene"`
	Split               string          `json:"split"`
	Intent              string          `json:"intent"`
	ExpectedIntent      string          `json:"expected_intent"`
	Passed              bool            `json:"passed"`
	DeterministicScores json.RawMessage `json:"deterministic_scores"`
	Judge               json.RawMessage `json:"judge"`
	// Decode as float so a fractional latency (e.g. 7077.4) never 400s the
	// whole run; we round to int when persisting.
	LatencyMs           float64         `json:"latency_ms"`
}

// IngestRun handles POST /internal/evals/run.
// Validates the mandatory fields, then persists the run summary and all
// per-turn records. Uses a 30 MiB body limit to allow large eval batches.
func (h *InternalEvalsHandler) IngestRun(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}

	// Allow larger bodies than the default 64 KiB — eval payloads with
	// hundreds of turns including full transcripts can exceed that limit.
	const maxEvalBody = 30 * 1024 * 1024 // 30 MiB
	r.Body = http.MaxBytesReader(w, r.Body, maxEvalBody)

	var payload evalRunPayload
	dec := json.NewDecoder(r.Body)
	// Do NOT DisallowUnknownFields — the breakdowns/judge sub-objects are
	// arbitrary and captured via json.RawMessage.
	if err := dec.Decode(&payload); err != nil {
		slog.Warn("internal evals: decode error", "err", err)
		httpx.WriteValidationError(w, "invalid JSON payload")
		return
	}

	if payload.RunID == "" {
		httpx.WriteValidationError(w, "run_id is required")
		return
	}
	if payload.Kind == "" {
		httpx.WriteValidationError(w, "kind is required")
		return
	}
	if payload.Kind != "offline" && payload.Kind != "online" {
		httpx.WriteValidationError(w, "kind must be 'offline' or 'online'")
		return
	}
	// Channel is which agent surface this run evaluated. Empty (legacy / older
	// AI builds) defaults to chat; anything else must be a known channel.
	if payload.Channel == "" {
		payload.Channel = "chat"
	}
	if payload.Channel != "chat" && payload.Channel != "voice" && payload.Channel != "phone" {
		httpx.WriteValidationError(w, "channel must be 'chat', 'voice', or 'phone'")
		return
	}
	if payload.CreatedAt.IsZero() {
		payload.CreatedAt = time.Now().UTC()
	}

	// Marshal breakdowns back to a JSON string for storage.
	breakdownsJSON := ""
	if len(payload.Breakdowns) > 0 && string(payload.Breakdowns) != "null" {
		breakdownsJSON = string(payload.Breakdowns)
	}

	regressionJSON := ""
	if len(payload.Regression) > 0 && string(payload.Regression) != "null" {
		regressionJSON = string(payload.Regression)
	}

	run := phi.EvalRun{
		RunID:          payload.RunID,
		Kind:           payload.Kind,
		Channel:        payload.Channel,
		Model:          payload.Model,
		PromptVersion:  payload.PromptVersion,
		DatasetVersion: payload.DatasetVersion,
		CreatedAt:      payload.CreatedAt.UTC(),
		Counts:         payload.Counts,
		MetricCounts:   payload.MetricCounts,
		Metrics:        payload.Metrics,
		BreakdownsJSON: breakdownsJSON,
		RegressionJSON: regressionJSON,
	}

	if err := h.PHI.PutEvalRun(r.Context(), run); err != nil {
		slog.Error("internal evals: put run", "run_id", payload.RunID, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "failed to store eval run")
		return
	}

	// Convert turn payloads to phi.EvalTurn.
	turns := make([]phi.EvalTurn, 0, len(payload.Turns))
	for _, tp := range payload.Turns {
		detScoresJSON := ""
		if len(tp.DeterministicScores) > 0 && string(tp.DeterministicScores) != "null" {
			detScoresJSON = string(tp.DeterministicScores)
		}
		judgeJSON := ""
		if len(tp.Judge) > 0 && string(tp.Judge) != "null" {
			judgeJSON = string(tp.Judge)
		}
		turns = append(turns, phi.EvalTurn{
			RunID:                   payload.RunID,
			Seq:                     tp.Seq,
			SessionID:               tp.SessionID,
			ConvoName:               tp.ConvoName,
			IsProduction:            tp.IsProduction,
			UserSays:                tp.UserSays,
			Reply:                   tp.Reply,
			Scene:                   tp.Scene,
			Split:                   tp.Split,
			Intent:                  tp.Intent,
			ExpectedIntent:          tp.ExpectedIntent,
			Passed:                  tp.Passed,
			DeterministicScoresJSON: detScoresJSON,
			JudgeJSON:               judgeJSON,
			LatencyMs:               int(math.Round(tp.LatencyMs)),
			CreatedAt:               payload.CreatedAt.UTC(),
		})
	}

	if err := h.PHI.PutEvalTurns(r.Context(), payload.RunID, turns); err != nil {
		slog.Error("internal evals: put turns", "run_id", payload.RunID, "n", len(turns), "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "failed to store eval turns")
		return
	}

	slog.Info("internal evals: run ingested",
		"run_id", payload.RunID,
		"kind", payload.Kind,
		"turns", len(turns),
	)
	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

// runLightSummary is the small, non-PHI projection returned by RecentRuns.
// No turns, transcripts, or breakdowns — just aggregate metadata so the AI
// harness can fetch baselines without pulling large eval payloads.
type runLightSummary struct {
	RunID          string             `json:"run_id"`
	Kind           string             `json:"kind"`
	Channel        string             `json:"channel"`
	Model          string             `json:"model"`
	PromptVersion  string             `json:"prompt_version"`
	DatasetVersion string             `json:"dataset_version"`
	CreatedAt      string             `json:"created_at"`
	Counts         map[string]int     `json:"counts"`
	Metrics        map[string]float64 `json:"metrics"`
}

// RecentRuns handles GET /internal/evals/runs?kind=&limit=
// Returns a light summary array of recent eval runs. No turns, no transcripts,
// no breakdowns — only aggregate metadata for the AI harness baseline queries.
// No LogPHIAccess needed: no PHI is returned (metrics + version strings only).
func (h *InternalEvalsHandler) RecentRuns(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}

	kindFilter := r.URL.Query().Get("kind")
	if kindFilter != "" && kindFilter != "offline" && kindFilter != "online" {
		httpx.WriteValidationError(w, "kind must be 'offline' or 'online'")
		return
	}

	// Optional channel filter so the AI harness fetches like-channel baselines.
	channelFilter := r.URL.Query().Get("channel")
	if channelFilter != "" && channelFilter != "chat" && channelFilter != "voice" && channelFilter != "phone" {
		httpx.WriteValidationError(w, "channel must be 'chat', 'voice', or 'phone'")
		return
	}

	limit := 10
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			if n < 1 {
				n = 1
			}
			if n > 50 {
				n = 50
			}
			limit = n
		}
	}

	// Over-fetch so we have enough after kind + channel filtering. With up to
	// 3 channels × 2 kinds interleaved, fetch generously then cap at 100.
	fetchLimit := limit * 6
	if fetchLimit > 100 {
		fetchLimit = 100
	}

	runs, err := h.PHI.ListEvalRuns(r.Context(), int32(fetchLimit))
	if err != nil {
		slog.Error("internal evals: list runs", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	out := make([]runLightSummary, 0, limit)
	for _, run := range runs {
		if kindFilter != "" && run.Kind != kindFilter {
			continue
		}
		// Effective channel: legacy rows with no channel attribute are chat.
		runChannel := run.Channel
		if runChannel == "" {
			runChannel = "chat"
		}
		if channelFilter != "" && runChannel != channelFilter {
			continue
		}
		out = append(out, runLightSummary{
			RunID:          run.RunID,
			Kind:           run.Kind,
			Channel:        runChannel,
			Model:          run.Model,
			PromptVersion:  run.PromptVersion,
			DatasetVersion: run.DatasetVersion,
			CreatedAt:      run.CreatedAt.UTC().Format(time.RFC3339),
			Counts:         run.Counts,
			Metrics:        run.Metrics,
		})
		if len(out) >= limit {
			break
		}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"runs": out})
}

// recentSessionRow is the non-PHI pointer returned to the AI eval harness.
type recentSessionRow struct {
	SessionID    string    `json:"session_id"`
	Source       string    `json:"source"`
	StartedAt    time.Time `json:"started_at"`
	MessageCount int       `json:"message_count"`
}

// RecentSessions handles GET /internal/chat/recent?limit=&hours=
// Returns recent chat-session metadata from Postgres (non-PHI pointer rows).
// The AI eval harness uses this to sample sessions for online evals.
func (h *InternalEvalsHandler) RecentSessions(w http.ResponseWriter, r *http.Request) {
	if h.Pool == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "pool not configured")
		return
	}

	limit := 50
	if s := r.URL.Query().Get("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 500 {
			limit = n
		}
	}

	hours := 24
	if s := r.URL.Query().Get("hours"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 && n <= 720 {
			hours = n
		}
	}

	since := time.Now().UTC().Add(-time.Duration(hours) * time.Hour)

	// Optional exact-match source filter (chat-agent | voice-agent | voice-phone)
	// so per-channel online evals only sample that channel's sessions. Always
	// parameterized — never string-concatenated into the SQL.
	source := r.URL.Query().Get("source")

	var rows pgx.Rows
	var err error
	if source != "" {
		rows, err = h.Pool.Query(r.Context(),
			`SELECT id, source, started_at, message_count
			   FROM bt.chat_sessions
			  WHERE started_at >= $1
			    AND purged_at IS NULL
			    AND source = $3
			  ORDER BY started_at DESC
			  LIMIT $2`,
			since, limit, source,
		)
	} else {
		rows, err = h.Pool.Query(r.Context(),
			`SELECT id, source, started_at, message_count
			   FROM bt.chat_sessions
			  WHERE started_at >= $1
			    AND purged_at IS NULL
			  ORDER BY started_at DESC
			  LIMIT $2`,
			since, limit,
		)
	}
	if err != nil {
		slog.Error("internal chat recent: query", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()

	sessions := make([]recentSessionRow, 0, limit)
	for rows.Next() {
		var row recentSessionRow
		if err := rows.Scan(&row.SessionID, &row.Source, &row.StartedAt, &row.MessageCount); err != nil {
			slog.Error("internal chat recent: scan", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		sessions = append(sessions, row)
	}
	if err := rows.Err(); err != nil {
		slog.Error("internal chat recent: rows error", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, sessions)
}
