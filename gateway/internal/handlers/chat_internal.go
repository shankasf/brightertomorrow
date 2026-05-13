package handlers

import (
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ChatInternalHandler exposes the chat-turn read/write API to in-cluster
// callers (the AI pod). Mounted under /internal/* — that namespace is not
// routed by Traefik, so the network boundary IS the auth boundary. Do NOT
// add /internal/* to the public ingress.
//
// All chat content lives in DynamoDB; this handler is the only path AI uses
// to read or append turns. Postgres counters are bumped here too so the
// admin dashboard stays accurate without ever seeing message bodies.
type ChatInternalHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store
}

type chatTurnRequest struct {
	SessionID string `json:"session_id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
}

// PutTurn handles POST /internal/chat/turn.
func (h *ChatInternalHandler) PutTurn(w http.ResponseWriter, r *http.Request) {
	var body chatTurnRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if body.SessionID == "" || body.Role == "" || body.Content == "" {
		httpx.WriteValidationError(w, "session_id, role, and content are required")
		return
	}
	switch body.Role {
	case "user", "assistant", "system", "tool":
	default:
		httpx.WriteValidationError(w, "role must be user|assistant|system|tool")
		return
	}
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}
	if err := recordTurn(r.Context(), h.Pool, h.PHI, body.SessionID, body.Role, body.Content); err != nil {
		slog.Error("internal chat turn", "err", err, "session_id", body.SessionID)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// EndSession handles POST /internal/chat/end. Called by the AI pod when a
// realtime voice or Twilio call session terminates, so the chat_sessions row
// flips out of "active" immediately instead of waiting for the idle sweeper.
// No PHI; no body content; ownership check is moot for in-cluster callers.
func (h *ChatInternalHandler) EndSession(w http.ResponseWriter, r *http.Request) {
	var body struct {
		SessionID string `json:"session_id"`
	}
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if body.SessionID == "" {
		httpx.WriteValidationError(w, "session_id is required")
		return
	}
	MarkSessionEnded(h.Pool, body.SessionID)
	w.WriteHeader(http.StatusNoContent)
}

// History handles GET /internal/chat/history?session_id=...&limit=...
// Returns oldest-first by default so the AI can replay context. Capped
// at the most recent N turns to keep the prompt small.
func (h *ChatInternalHandler) History(w http.ResponseWriter, r *http.Request) {
	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		httpx.WriteValidationError(w, "session_id is required")
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 200 {
		limit = 20
	}
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}
	// Pull newest-first then reverse — gives us "the most recent N turns
	// in chronological order" which is what an LLM expects.
	turns, err := h.PHI.ListChatTurns(r.Context(), sessionID, int32(limit), true)
	if err != nil {
		slog.Error("internal chat history", "err", err, "session_id", sessionID)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	// Reverse to oldest-first.
	out := make([]map[string]string, 0, len(turns))
	for i := len(turns) - 1; i >= 0; i-- {
		t := turns[i]
		out = append(out, map[string]string{
			"role":       t.Role,
			"content":    t.Content,
			"created_at": t.CreatedAt.UTC().Format(time.RFC3339),
		})
	}
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"messages": out})
}
