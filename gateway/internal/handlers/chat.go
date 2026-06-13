package handlers

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"time"
	"unicode/utf8"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
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
	PHI          *phi.Store
	AIClient     AIChatter
	CookieSecure bool
}

// recordTurn writes a chat turn to DynamoDB and bumps the non-PHI counters
// on bt.chat_sessions. Postgres never sees the message body.
func recordTurn(ctx context.Context, pool chatDB, store *phi.Store, sessionID, role, content string, latencyMs int) error {
	if store == nil {
		// Fail-closed: PHI store must be configured for chat to write.
		return errors.New("phi store not configured")
	}
	now := time.Now().UTC()
	if err := store.PutChatTurn(ctx, phi.ChatTurn{
		SessionID: sessionID,
		Role:      role,
		Content:   content,
		CreatedAt: now,
		LatencyMs: latencyMs,
	}); err != nil {
		return err
	}
	// Bump counters. Best-effort; the source of truth is DynamoDB.
	_, _ = pool.Exec(ctx,
		`UPDATE bt.chat_sessions
		 SET message_count = message_count + 1,
		     last_message_at = $2
		 WHERE id = $1`,
		sessionID, now,
	)
	return nil
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

	// Persist the user message to DynamoDB — except for the greeting trigger,
	// which is a synthetic signal from the widget asking the AI to produce
	// an opener. The AI-generated greeting is still persisted below.
	const greetMarker = "__BT_GREET__"
	if body.Message != greetMarker {
		if err := recordTurn(ctx, h.Pool, h.PHI, sessionID, "user", body.Message, 0); err != nil {
			slog.Error("chat: ddb put user turn", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
	}

	// Call the AI service; fall back gracefully on any error. Time it so the
	// assistant turn carries its end-to-end latency for online evals.
	aiStart := time.Now()
	reply, err := h.AIClient.Chat(ctx, sessionID, body.Message)
	if err != nil {
		slog.Warn("chat: ai service error, using fallback", "err", err)
		reply = chatFallback
	}
	latencyMs := int(time.Since(aiStart).Milliseconds())

	// Persist the assistant reply using a background context so a client
	// disconnect after the AI call cannot leave history in a torn state.
	persistCtx, persistCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer persistCancel()
	if err := recordTurn(persistCtx, h.Pool, h.PHI, sessionID, "assistant", reply, latencyMs); err != nil {
		slog.Warn("chat: ddb put assistant turn", "err", err)
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]string{
		"session_id": sessionID,
		"reply":      reply,
	})
}
