package handlers

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strings"

	chimw "github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
)

var wsUpgrader = websocket.Upgrader{
	CheckOrigin:     func(r *http.Request) bool { return true },
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
}

// VoiceHandler proxies WebSocket connections to the AI voice service.
// It enforces session ownership via the same visitor cookie used by ChatHandler.
type VoiceHandler struct {
	Pool         chatDB
	AIServiceURL string
	CookieSecure bool
}

func (h *VoiceHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// 1. Validate session_id query param.
	sessionID := r.URL.Query().Get("session_id")
	if sessionID == "" {
		httpx.WriteError(w, http.StatusBadRequest, "session_id is required")
		return
	}
	if _, err := uuid.Parse(sessionID); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "session_id must be a valid UUID")
		return
	}

	// 2. Resolve or mint the visitor cookie.
	visitorID := ensureVisitor(w, r, h.CookieSecure)

	// 3. IDOR check: session must exist and belong to this visitor.
	ctx := r.Context()
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
		slog.Error("voice: lookup session", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	if owner == nil || *owner != visitorID {
		slog.Warn("voice: visitor mismatch", "session_id", sessionID)
		httpx.WriteError(w, http.StatusNotFound, "session not found")
		return
	}

	// 4. Upgrade the client connection to WebSocket.
	clientConn, err := wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		// Upgrade writes the HTTP error itself on failure; just log.
		slog.Warn("voice: upgrade client connection",
			"err", err,
			"request_id", chimw.GetReqID(r.Context()),
			"session_id", sessionID,
			"upgrade_header", r.Header.Get("Upgrade"),
			"connection_header", r.Header.Get("Connection"),
			"user_agent", r.Header.Get("User-Agent"),
		)
		return
	}
	defer clientConn.Close()

	// 5. Dial the AI service WebSocket.
	aiURL, err := aiWebSocketURL(h.AIServiceURL, sessionID)
	if err != nil {
		slog.Error("voice: build ai websocket url", "err", err)
		clientConn.WriteMessage( //nolint:errcheck
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseInternalServerErr, "internal error"),
		)
		return
	}

	aiConn, _, err := websocket.DefaultDialer.DialContext(ctx, aiURL, nil)
	if err != nil {
		slog.Warn("voice: dial ai service", "url", aiURL, "err", err)
		clientConn.WriteMessage( //nolint:errcheck
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseTryAgainLater, "ai service unavailable"),
		)
		return
	}
	defer aiConn.Close()

	// 6. Bidirectional proxy — two goroutines, first error wins.
	errCh := make(chan error, 2)

	// client → AI
	go func() {
		errCh <- proxyMessages(clientConn, aiConn)
	}()

	// AI → client
	go func() {
		errCh <- proxyMessages(aiConn, clientConn)
	}()

	// Wait for the first side to finish (normal close or error).
	if proxyErr := <-errCh; proxyErr != nil && !isExpectedCloseError(proxyErr) {
		slog.Warn("voice: proxy error", "err", proxyErr)
	}

	// Signal the other goroutine to stop by closing both connections.
	// Close messages are best-effort; ignore write errors here.
	clientConn.WriteMessage( //nolint:errcheck
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
	)
	aiConn.WriteMessage( //nolint:errcheck
		websocket.CloseMessage,
		websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""),
	)
}

// proxyMessages reads every message from src and writes it verbatim to dst.
// It returns when src is closed or an error occurs.
func proxyMessages(src, dst *websocket.Conn) error {
	for {
		msgType, msg, err := src.ReadMessage()
		if err != nil {
			return err
		}
		if err := dst.WriteMessage(msgType, msg); err != nil {
			return err
		}
	}
}

// isExpectedCloseError reports whether err is a normal WebSocket close event
// that we should not treat as an unexpected failure.
func isExpectedCloseError(err error) bool {
	return websocket.IsCloseError(err,
		websocket.CloseNormalClosure,
		websocket.CloseGoingAway,
		websocket.CloseNoStatusReceived,
	)
}

// aiWebSocketURL converts an HTTP(S) base URL to a WebSocket URL pointing at
// the AI voice endpoint with the given session_id query parameter.
func aiWebSocketURL(httpURL, sessionID string) (string, error) {
	u, err := url.Parse(httpURL)
	if err != nil {
		return "", err
	}
	switch strings.ToLower(u.Scheme) {
	case "http":
		u.Scheme = "ws"
	case "https":
		u.Scheme = "wss"
	}
	u.Path = "/ws/voice"
	q := u.Query()
	q.Set("session_id", sessionID)
	u.RawQuery = q.Encode()
	return u.String(), nil
}
