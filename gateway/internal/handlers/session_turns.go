// session_turns.go — POST /internal/phi/session_turns
//
// Gate handler for gate_resume_offer in the clinical-intake LangGraph.
// Fetches the last N turns of a prior chat/voice session from DynamoDB so
// the gate can summarise them for the returning patient.
//
// HIPAA: chat turns may contain PHI, but this endpoint is purely internal
// (not routed by Traefik, cluster-network boundary only). The AI pod is the
// authorised consumer. Audit row is written per call.
// Non-200 is never returned on missing/empty data — returns {"turns":[]} instead.
package handlers

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
)

// SessionTurnsHandler serves POST /internal/phi/session_turns.
type SessionTurnsHandler struct {
	PHI *phi.Store
}

type sessionTurnsRequest struct {
	SessionID string `json:"session_id"`
	Limit     int    `json:"limit"`
}

type sessionTurnItem struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	TS      string `json:"ts"`
}

func (h *SessionTurnsHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body sessionTurnsRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		slog.Warn("session_turns: bad json body", "err", err)
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"turns": []sessionTurnItem{}})
		return
	}

	if body.SessionID == "" {
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"turns": []sessionTurnItem{}})
		return
	}

	limit := body.Limit
	if limit < 1 || limit > 10 {
		limit = 3 // default: 3 most-recent turns
	}

	if h.PHI == nil {
		slog.Error("session_turns: phi store not configured")
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"turns": []sessionTurnItem{}})
		return
	}

	ctx := r.Context()

	// Fetch newest-first so limit=3 gives us the last 3 turns.
	turns, err := h.PHI.ListChatTurns(ctx, body.SessionID, int32(limit), true)
	if err != nil {
		slog.Error("session_turns: list failed", "err", err, "session_id", body.SessionID)
		// Fail open — return empty turns rather than blocking the gate.
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"turns": []sessionTurnItem{}})
		return
	}

	// Reverse to chronological order (oldest → newest) for the LLM context window.
	out := make([]sessionTurnItem, 0, len(turns))
	for i := len(turns) - 1; i >= 0; i-- {
		t := turns[i]
		out = append(out, sessionTurnItem{
			Role:    t.Role,
			Content: t.Content,
			TS:      t.CreatedAt.UTC().Format(time.RFC3339),
		})
	}

	sessionTurnsWriteAudit(ctx, h.PHI, body.SessionID, len(out))

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"turns": out})
}

// sessionTurnsWriteAudit records that session turns were read by bt-ai.
// Only session_id and turn count are logged — no content.
func sessionTurnsWriteAudit(ctx context.Context, store *phi.Store, sessionID string, count int) {
	if store == nil {
		return
	}
	row := phi.AccessAuditRecord{
		AuditID:      uuid.NewString(),
		AdminEmail:   "bt-ai",
		Action:       "session_turns_read",
		ResourceType: "chat_session",
		ResourceID:   sessionID,
		CreatedAt:    time.Now().UTC(),
	}
	go func() {
		auditCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := store.PutAccessAudit(auditCtx, row); err != nil {
			slog.Error("session_turns: audit write failed", "err", err, "session_id", sessionID)
		}
	}()
}
