// Package handlers — POST /v1/chat/end + helper for socket-close paths.
//
// Called by the chat widget on tab-close (navigator.sendBeacon) so the session
// flips out of "active" the moment the visitor leaves, instead of waiting for
// the 20-minute idle sweeper. Same visitor-cookie ownership check as the rest
// of /v1/chat — an attacker cannot end someone else's session.
//
// The voice and Twilio handlers also call MarkSessionEnded directly when their
// WebSocket proxy exits, so phone hangups and tab-close-during-voice both
// terminate the row immediately.
package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
)

// ChatEndHandler handles POST /v1/chat/end.
type ChatEndHandler struct {
	Pool         chatDB
	CookieSecure bool
}

type chatEndRequest struct {
	SessionID string `json:"session_id"`
}

func (h *ChatEndHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// sendBeacon ships with Content-Type: text/plain;charset=UTF-8 by default;
	// httpx.ReadJSON does not gate on Content-Type so the JSON body still
	// decodes cleanly.
	var body chatEndRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if _, err := uuid.Parse(body.SessionID); err != nil {
		httpx.WriteValidationError(w, "session_id must be a valid UUID")
		return
	}

	// Read the visitor cookie WITHOUT minting one — an end request from a
	// browser that has no session cookie is a no-op (or a probe).
	c, cerr := r.Cookie(visitorCookieName)
	if cerr != nil || c.Value == "" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if _, err := uuid.Parse(c.Value); err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	ctx := r.Context()
	var owner *string
	err := h.Pool.QueryRow(ctx,
		`SELECT visitor_id FROM bt.chat_sessions WHERE id = $1`,
		body.SessionID,
	).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		slog.Error("chat end: lookup session", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if owner == nil || *owner != c.Value {
		// Silent — don't leak whether the session exists.
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if err := markEnded(ctx, h.Pool, body.SessionID); err != nil {
		slog.Error("chat end: update", "err", err, "session_id", body.SessionID)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// MarkSessionEnded writes ended_at=now() on bt.chat_sessions if it is NULL.
// Safe to call multiple times: COALESCE preserves the earliest ended_at.
//
// Uses a short detached timeout so it survives the originating request/WS
// context cancellation (which is the whole point — the socket just closed).
func MarkSessionEnded(pool chatDB, sessionID string) {
	if pool == nil || sessionID == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := markEnded(ctx, pool, sessionID); err != nil {
		slog.Warn("chat end: socket-close update", "err", err, "session_id", sessionID)
	}
}

func markEnded(ctx context.Context, pool chatDB, sessionID string) error {
	_, err := pool.Exec(ctx,
		`UPDATE bt.chat_sessions
		 SET ended_at = COALESCE(ended_at, now())
		 WHERE id = $1`,
		sessionID,
	)
	return err
}
