package handlers

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// AIStreamer is the minimal interface ChatStreamHandler needs from the AI client.
type AIStreamer interface {
	ChatStream(ctx context.Context, sessionID, message string) (*http.Response, error)
}

// ChatStreamHandler handles POST /v1/chat/stream.
// It mirrors ChatHandler's auth/IDOR/persistence logic and then proxies the
// upstream SSE body to the client, accumulating the full reply for DB persistence.
type ChatStreamHandler struct {
	Pool         chatDB
	PHI          *phi.Store
	AIClient     AIStreamer
	CookieSecure bool
}

func (h *ChatStreamHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

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
			slog.Error("chat_stream: create session", "err", err)
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
			slog.Error("chat_stream: lookup session", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		if owner == nil || *owner != visitorID {
			slog.Warn("chat_stream: visitor mismatch", "session_id", sessionID)
			httpx.WriteError(w, http.StatusNotFound, "session not found")
			return
		}
	}

	// Persist the user message to DynamoDB — skip the synthetic greeting marker.
	const greetMarker = "__BT_GREET__"
	if body.Message != greetMarker {
		if err := recordTurn(ctx, h.Pool, h.PHI, sessionID, "user", body.Message); err != nil {
			slog.Error("chat_stream: ddb put user turn", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
	}

	slog.Info("chat_stream: start", "session_id", sessionID, "msg_len", len(body.Message))

	// Negotiate SSE with the client before touching the upstream.
	flusher, ok := w.(http.Flusher)
	if !ok {
		// Fallback: the transport doesn't support flushing (e.g. test recorder).
		// Use the regular Chat path and emit a single SSE frame.
		slog.Warn("chat_stream: flusher not supported, falling back to non-stream")
		h.fallback(w, ctx, sessionID, body.Message, start)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")

	// Open the upstream stream. Use a fresh context so client disconnect doesn't
	// prevent us from reaching the upstream at all — we rely on ctx for propagation.
	upstreamResp, err := h.AIClient.ChatStream(ctx, sessionID, body.Message)
	if err != nil {
		slog.Warn("chat_stream: ai dial failed", "err", err, "session_id", sessionID)
		writeSSEEvent(w, "message", chatFallback)
		writeSSEEvent(w, "done", "")
		flusher.Flush()
		h.persistReply(sessionID, chatFallback)
		return
	}
	defer upstreamResp.Body.Close()

	if upstreamResp.StatusCode < 200 || upstreamResp.StatusCode >= 300 {
		slog.Warn("chat_stream: ai status", "status", upstreamResp.StatusCode, "session_id", sessionID)
		writeSSEEvent(w, "message", chatFallback)
		writeSSEEvent(w, "done", "")
		flusher.Flush()
		h.persistReply(sessionID, chatFallback)
		return
	}

	// Stream the upstream SSE body to the client line by line.
	// Simultaneously parse delta events to accumulate the full reply.
	var (
		accumulated strings.Builder
		clientGone  bool
	)

	scanner := bufio.NewScanner(upstreamResp.Body)
	// Increase scanner buffer — delta payloads can be large.
	scanner.Buffer(make([]byte, 64*1024), 64*1024)

	// pendingBlock holds lines belonging to the current SSE event block.
	// We flush to the client (and parse) on the empty-line boundary.
	var pendingBlock []string

	for scanner.Scan() {
		// If the client disconnected, keep reading upstream to accumulate the
		// reply but stop writing — we still want to persist.
		select {
		case <-ctx.Done():
			clientGone = true
		default:
		}

		line := scanner.Text()
		pendingBlock = append(pendingBlock, line)

		if line == "" {
			// Empty line = end of one SSE event block. Forward and parse.
			if !clientGone {
				for _, l := range pendingBlock {
					fmt.Fprintf(w, "%s\n", l)
				}
				fmt.Fprint(w, "\n")
				flusher.Flush()
			}
			// Parse any delta text out of the block.
			parseDeltaBlock(pendingBlock, &accumulated)
			pendingBlock = pendingBlock[:0]
		}
	}

	// Flush any trailing lines that arrived without a final blank line.
	if len(pendingBlock) > 0 {
		if !clientGone {
			for _, l := range pendingBlock {
				fmt.Fprintf(w, "%s\n", l)
			}
			fmt.Fprint(w, "\n")
			flusher.Flush()
		}
		parseDeltaBlock(pendingBlock, &accumulated)
	}

	if err := scanner.Err(); err != nil {
		slog.Warn("chat_stream: scanner error", "err", err, "session_id", sessionID)
	}

	reply := accumulated.String()
	if reply == "" {
		reply = chatFallback
	}

	slog.Info("chat_stream: done",
		"session_id", sessionID,
		"total_ms", time.Since(start).Milliseconds(),
		"chars", len(reply),
		"client_disconnected", clientGone,
	)

	h.persistReply(sessionID, reply)
}

// fallback is used when the ResponseWriter doesn't support http.Flusher.
// It calls the non-streaming AI path and writes a single SSE frame.
func (h *ChatStreamHandler) fallback(w http.ResponseWriter, ctx context.Context, sessionID, message string, start time.Time) {
	// Headers must still be set before first write.
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")
	w.Header().Set("Connection", "keep-alive")

	reply := chatFallback

	slog.Info("chat_stream: done (fallback)",
		"session_id", sessionID,
		"total_ms", time.Since(start).Milliseconds(),
		"chars", len(reply),
		"client_disconnected", false,
	)

	writeSSEEvent(w, "message", reply)
	writeSSEEvent(w, "done", "")
	h.persistReply(sessionID, reply)
}

// persistReply records the assistant reply in DynamoDB using a background
// context so a disconnected client can't leave history in a torn state.
func (h *ChatStreamHandler) persistReply(sessionID, reply string) {
	persistCtx, persistCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer persistCancel()
	if err := recordTurn(persistCtx, h.Pool, h.PHI, sessionID, "assistant", reply); err != nil {
		slog.Error("chat_stream: persist assistant reply", "err", err, "session_id", sessionID)
	}
}

// writeSSEEvent writes a named SSE event with data to w.
// Format: "event: <name>\ndata: <payload>\n\n"
func writeSSEEvent(w http.ResponseWriter, event, data string) {
	fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, data)
}

// deltaPayload is the JSON shape of a "delta" SSE event from the AI service.
type deltaPayload struct {
	Text string `json:"text"`
}

// parseDeltaBlock inspects lines from one SSE event block and, if it is a
// delta event, appends the text fragment to acc.
func parseDeltaBlock(lines []string, acc *strings.Builder) {
	var isEvent bool
	var rawData string
	for _, l := range lines {
		switch {
		case l == "event: delta":
			isEvent = true
		case strings.HasPrefix(l, "data: "):
			rawData = strings.TrimPrefix(l, "data: ")
		}
	}
	if !isEvent || rawData == "" {
		return
	}
	var p deltaPayload
	if err := json.Unmarshal([]byte(rawData), &p); err != nil {
		return
	}
	acc.WriteString(p.Text)
}
