package handlers

// chat_feedback.go — public thumbs-up/thumbs-down rating for chat turns.
//
// POST /api/chat/feedback — no auth; rate-limited by IP at the router.
//
// Only the rating ("up" | "down") is stored — never message text.
// DDB key:
//   PK = "CHATFEEDBACK#<session_id>"
//   SK = "TURN#<zero-padded turn_index>"
//
// This is non-PHI operational data (rating only, no identifying information).
// No PHI audit row is written. See phi.ChatFeedback for retention policy.

import (
	"log/slog"
	"net/http"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
)

// ChatFeedbackHandler serves POST /api/chat/feedback.
type ChatFeedbackHandler struct {
	PHI *phi.Store
}

type chatFeedbackRequest struct {
	SessionID string `json:"session_id"`
	TurnIndex int    `json:"turn_index"`
	Rating    string `json:"rating"` // "up" | "down"
}

// ServeHTTP handles POST /api/chat/feedback.
func (h *ChatFeedbackHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}

	var req chatFeedbackRequest
	if err := httpx.ReadJSON(w, r, &req); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if req.SessionID == "" {
		httpx.WriteValidationError(w, "session_id is required")
		return
	}
	if req.TurnIndex < 0 {
		httpx.WriteValidationError(w, "turn_index must be >= 0")
		return
	}
	if req.Rating != "up" && req.Rating != "down" {
		httpx.WriteValidationError(w, "rating must be 'up' or 'down'")
		return
	}

	fb := phi.ChatFeedback{
		SessionID: req.SessionID,
		TurnIndex: req.TurnIndex,
		Rating:    req.Rating,
	}

	if err := h.PHI.PutChatFeedback(r.Context(), fb); err != nil {
		slog.Error("chat feedback: put", "session_id", req.SessionID, "turn_index", req.TurnIndex, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}
