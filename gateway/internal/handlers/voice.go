package handlers

import (
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"
	"time"

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
	//    If the session doesn't exist yet (voice-first flow), create it now.
	ctx := r.Context()
	var owner *string
	err := h.Pool.QueryRow(ctx,
		`SELECT visitor_id FROM bt.chat_sessions WHERE id = $1`,
		sessionID,
	).Scan(&owner)
	if errors.Is(err, pgx.ErrNoRows) {
		// Voice-first: create the session for this visitor so the IDOR check passes.
		_, insertErr := h.Pool.Exec(ctx,
			`INSERT INTO bt.chat_sessions (id, visitor_id, source) VALUES ($1, $2, 'voice-agent') ON CONFLICT DO NOTHING`,
			sessionID, visitorID,
		)
		if insertErr != nil {
			slog.Error("voice: create session", "err", insertErr)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		owner = &visitorID
	} else if err != nil {
		slog.Error("voice: lookup session", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	} else {
		// A chat-first session is being upgraded to voice. Promote the
		// source so the admin "Chat Sessions" view reflects the latest
		// modality. Only widens chat-agent → voice-agent; never reverse.
		_, _ = h.Pool.Exec(ctx,
			`UPDATE bt.chat_sessions SET source = 'voice-agent' WHERE id = $1 AND source = 'chat-agent'`,
			sessionID,
		)
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
	start := time.Now()
	var c2a, a2c proxyStats
	slog.Info("voice: bridge open", "session_id", sessionID)
	errCh := make(chan error, 2)

	// client → AI
	go func() {
		errCh <- proxyMessages(clientConn, aiConn, &c2a)
	}()

	// AI → client
	go func() {
		errCh <- proxyMessages(aiConn, clientConn, &a2c)
	}()

	// Wait for the first side to finish (normal close or error).
	proxyErr := <-errCh
	// Always log the bridge close with per-direction frame/byte counts +
	// duration so a stalled or one-sided proxy is immediately visible.
	slog.Info("voice: bridge closed",
		"session_id", sessionID,
		"duration_s", time.Since(start).Seconds(),
		"client2ai_frames", c2a.frames.Load(), "client2ai_bytes", c2a.bytes.Load(),
		"ai2client_frames", a2c.frames.Load(), "ai2client_bytes", a2c.bytes.Load(),
		"err", fmt.Sprintf("%v", proxyErr),
	)
	if proxyErr != nil && !isExpectedCloseError(proxyErr) {
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

	// Mark the session ended now that the voice WS is closing — the visitor
	// hung up or closed the tab. Detached context so the originating request
	// cancellation doesn't abort the write.
	MarkSessionEnded(h.Pool, sessionID)
}

// proxyStats accumulates frame/byte counts for ONE direction of a WS proxy.
// The bridge-close log reads these so we can see exactly how much audio flowed
// each way — the key signal for isolating "frames reached the gateway but
// stalled before bt-ai" bugs from pipeline-side issues. Counters are atomic
// because the two proxy goroutines read/write them concurrently.
type proxyStats struct {
	frames atomic.Int64
	bytes  atomic.Int64
}

// proxyMessages reads every message from src and writes it verbatim to dst,
// tallying frames/bytes into st (nil-safe). Returns when src closes or errors.
func proxyMessages(src, dst *websocket.Conn, st *proxyStats) error {
	for {
		msgType, msg, err := src.ReadMessage()
		if err != nil {
			return err
		}
		if st != nil {
			st.frames.Add(1)
			st.bytes.Add(int64(len(msg)))
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
