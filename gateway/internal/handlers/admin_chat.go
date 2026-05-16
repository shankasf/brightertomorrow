package handlers

import (
	"log/slog"
	"net/http"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminChatHandler handles /admin/chat endpoints.
type AdminChatHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store
}

// ListSessions handles GET /admin/chat/sessions.
func (h *AdminChatHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	page, limit := parsePage(r)
	offset := (page - 1) * limit

	type sessionRow struct {
		ID           string  `json:"id"`
		VisitorID    *string `json:"visitor_id"`
		Source       string  `json:"source"`
		ExternalRef  *string `json:"external_ref"` // Twilio CallSid for voice-phone rows
		StartedAt    string  `json:"started_at"`
		EndedAt      *string `json:"ended_at"`
		MessageCount int     `json:"message_count"`
		PurgedAt     *string `json:"purged_at"`
	}

	// Optional source filter — keeps the page useful as voice-phone volume
	// grows. The column stores the canonical agent enum
	// {chat-agent, voice-agent, voice-phone} (migration 014). We also accept
	// the legacy short aliases {chat, voice} that older admin URLs may pass
	// and rewrite them transparently so bookmarks keep working.
	sourceFilter := r.URL.Query().Get("source")
	switch sourceFilter {
	case "chat":
		sourceFilter = "chat-agent"
	case "voice":
		sourceFilter = "voice-agent"
	}
	where := ""
	args := []any{limit, offset}
	switch sourceFilter {
	case "chat-agent", "voice-agent", "voice-phone":
		where = "WHERE s.source = $3"
		args = []any{limit, offset, sourceFilter}
	}

	rows, err := h.Pool.Query(r.Context(),
		`SELECT s.id, s.visitor_id, s.source, s.external_ref,
		        to_char(s.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		        to_char(s.ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		        s.message_count,
		        to_char(s.purged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		 FROM bt.chat_sessions s
		 `+where+`
		 ORDER BY s.started_at DESC
		 LIMIT $1 OFFSET $2`, args...)
	if err != nil {
		slog.Error("admin chat list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()

	var sessions []sessionRow
	for rows.Next() {
		var s sessionRow
		if err := rows.Scan(&s.ID, &s.VisitorID, &s.Source, &s.ExternalRef, &s.StartedAt, &s.EndedAt, &s.MessageCount, &s.PurgedAt); err != nil {
			slog.Error("admin chat scan", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		sessions = append(sessions, s)
	}
	if sessions == nil {
		sessions = []sessionRow{}
	}

	var total int
	if where != "" {
		_ = h.Pool.QueryRow(r.Context(),
			`SELECT count(*) FROM bt.chat_sessions WHERE source = $1`,
			sourceFilter,
		).Scan(&total)
	} else {
		_ = h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM bt.chat_sessions`).Scan(&total)
	}

	httpx.WriteJSON(w, http.StatusOK, pageResponse(sessions, total, page, limit))
}

// GetSession handles GET /admin/chat/sessions/:id — full session with messages.
// PHI access is logged. §164.312(b)
func (h *AdminChatHandler) GetSession(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")
	ctx := r.Context()

	type sessionDetail struct {
		ID          string  `json:"id"`
		VisitorID   *string `json:"visitor_id"`
		Source      string  `json:"source"`
		ExternalRef *string `json:"external_ref"`
		StartedAt   string  `json:"started_at"`
		EndedAt     *string `json:"ended_at"`
		RetainUntil *string `json:"retain_until"`
		PurgedAt    *string `json:"purged_at"`
	}
	type messageRow struct {
		Role      string `json:"role"`
		Content   string `json:"content"`
		CreatedAt string `json:"created_at"`
	}

	var s sessionDetail
	err := h.Pool.QueryRow(ctx,
		`SELECT id, visitor_id, source, external_ref,
		        to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		        to_char(ended_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		        to_char(retain_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
		        to_char(purged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		 FROM bt.chat_sessions WHERE id = $1`, sessionID,
	).Scan(&s.ID, &s.VisitorID, &s.Source, &s.ExternalRef, &s.StartedAt, &s.EndedAt, &s.RetainUntil, &s.PurgedAt)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}

	// Pull the transcript from DynamoDB. Postgres no longer stores message
	// bodies — keeps PHI off Hostinger entirely.
	messages := []messageRow{}
	if h.PHI != nil && s.PurgedAt == nil {
		turns, terr := h.PHI.ListChatTurns(ctx, sessionID, 500, false /* oldest first */)
		if terr != nil {
			slog.Error("admin chat: ddb list turns", "err", terr, "session_id", sessionID)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		for _, t := range turns {
			messages = append(messages, messageRow{
				Role:      t.Role,
				Content:   t.Content,
				CreatedAt: t.CreatedAt.UTC().Format(time.RFC3339),
			})
		}
	}

	// HIPAA §164.312(b): log PHI access.
	u, _ := appmw.AdminFromContext(ctx)
	admin.LogPHIAccess(ctx, h.PHI, r, u, "view_chat_session", "chat_session", sessionID)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"session":  s,
		"messages": messages,
	})
}
