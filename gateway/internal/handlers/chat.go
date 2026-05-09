package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

const chatFallback = "Thanks for reaching out! Our AI assistant is taking a quick break. " +
	"For immediate help, call 725-238-6990 or use our contact form."

const (
	visitorCookieName   = "bt_visitor"
	visitorCookieMaxAge = 8 * 60 * 60 // 8 hours — HIPAA §164.312(a)(2)(iii) automatic logoff
)

// AIChatter is the minimal interface the chat handler needs from the AI client.
type AIChatter interface {
	Chat(ctx context.Context, sessionID, message string) (string, error)
}

// chatDB is the minimal interface for database operations needed by ChatHandler.
// *pgxpool.Pool satisfies this interface.
type chatDB interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

type chatRequest struct {
	SessionID string `json:"session_id"`
	Message   string `json:"message"`
}

var errChatMessage = errors.New("message must be 1–2000 characters")

func (b *chatRequest) validate() error {
	if l := utf8.RuneCountInString(b.Message); l < 1 || l > 2000 {
		return errChatMessage
	}
	return nil
}

// ensureVisitor reads the visitor cookie or mints a new UUID and sets it.
func ensureVisitor(w http.ResponseWriter, r *http.Request, secure bool) string {
	if c, err := r.Cookie(visitorCookieName); err == nil && c.Value != "" {
		if _, uerr := uuid.Parse(c.Value); uerr == nil {
			return c.Value
		}
	}
	id := uuid.NewString()
	http.SetCookie(w, &http.Cookie{
		Name:     visitorCookieName,
		Value:    id,
		Path:     "/",
		MaxAge:   visitorCookieMaxAge,
		HttpOnly: true,
		Secure:   secure,
		SameSite: http.SameSiteStrictMode,
	})
	return id
}

// EnsureVisitor is exported for testing. It delegates to ensureVisitor with Secure: true.
func EnsureVisitor(w http.ResponseWriter, r *http.Request) string {
	return ensureVisitor(w, r, true)
}

// ValidateChatMessage is exported for testing. It validates a message string.
func ValidateChatMessage(message string) error {
	return (&chatRequest{Message: message}).validate()
}

// ChatHandler handles POST /v1/chat.
type ChatHandler struct {
	Pool         chatDB
	AIClient     AIChatter
	CookieSecure bool
}

func (h *ChatHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var body chatRequest
	if err := httpx.ReadJSON(w, r, &body); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}

	if err := body.validate(); err != nil {
		httpx.WriteValidationError(w, err.Error())
		return
	}

	// Validate session_id if provided.
	if body.SessionID != "" {
		if _, err := uuid.Parse(body.SessionID); err != nil {
			httpx.WriteValidationError(w, "session_id must be a valid UUID")
			return
		}
	}

	visitorID := ensureVisitor(w, r, h.CookieSecure)
	ctx := r.Context()
	sessionID := body.SessionID

	if sessionID == "" {
		// Create a new session tied to this visitor.
		row := h.Pool.QueryRow(ctx,
			`INSERT INTO bt.chat_sessions (visitor_id) VALUES ($1) RETURNING id`,
			visitorID,
		)
		if err := row.Scan(&sessionID); err != nil {
			slog.Error("chat: create session", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
	} else {
		// IDOR check: verify the session belongs to the current visitor.
		var owner *string
		err := h.Pool.QueryRow(ctx,
			`SELECT visitor_id FROM bt.chat_sessions WHERE id = $1`,
			sessionID,
		).Scan(&owner)
		if errors.Is(err, pgx.ErrNoRows) {
			httpx.WriteError(w, http.StatusNotFound, "session not found")
			return
		}
		if err != nil {
			slog.Error("chat: lookup session", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		if owner == nil || *owner != visitorID {
			slog.Warn("chat: visitor mismatch", "session_id", sessionID)
			httpx.WriteError(w, http.StatusNotFound, "session not found")
			return
		}
	}

	// Persist the user message — except for the greeting trigger, which is a
	// synthetic signal from the chat widget asking the AI to produce an opener.
	// The AI-generated greeting is still persisted below.
	const greetMarker = "__BT_GREET__"
	if body.Message != greetMarker {
		if _, err := h.Pool.Exec(ctx,
			`INSERT INTO bt.chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`,
			sessionID, body.Message,
		); err != nil {
			slog.Error("chat: insert user message", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
	}

	// Call the AI service; fall back gracefully on any error.
	reply, err := h.AIClient.Chat(ctx, sessionID, body.Message)
	if err != nil {
		slog.Warn("chat: ai service error, using fallback", "err", err)
		reply = chatFallback
	}

	// Persist the assistant reply using a background context so a client disconnect
	// after the AI call cannot leave chat history in a torn state (user message
	// without the corresponding assistant response).
	persistCtx, persistCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer persistCancel()
	_, _ = h.Pool.Exec(persistCtx,
		`INSERT INTO bt.chat_messages (session_id, role, content) VALUES ($1, 'assistant', $2)`,
		sessionID, reply,
	)

	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"session_id": sessionID,
		"reply":      reply,
	})
}
