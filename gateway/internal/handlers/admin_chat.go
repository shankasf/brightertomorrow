package handlers

import (
	"log/slog"
	"net/http"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminChatHandler handles /admin/chat endpoints.
type AdminChatHandler struct {
	Pool *pgxpool.Pool
}

// ListSessions handles GET /admin/chat/sessions.
func (h *AdminChatHandler) ListSessions(w http.ResponseWriter, r *http.Request) {
	page, limit := parsePage(r)
	offset := (page - 1) * limit

	type sessionRow struct {
		ID           string  `json:"id"`
		VisitorID    *string `json:"visitor_id"`
		Source       string  `json:"source"`
		StartedAt    string  `json:"started_at"`
		EndedAt      *string `json:"ended_at"`
		MessageCount int     `json:"message_count"`
		PurgedAt     *string `json:"purged_at"`
	}

	rows, err := h.Pool.Query(r.Context(),
		`SELECT s.id, s.visitor_id, s.source,
		        to_char(s.started_at, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
		        to_char(s.ended_at,   'YYYY-MM-DD"T"HH24:MI:SSOF'),
		        count(m.id) AS message_count,
		        to_char(s.purged_at,  'YYYY-MM-DD"T"HH24:MI:SSOF')
		 FROM bt.chat_sessions s
		 LEFT JOIN bt.chat_messages m ON m.session_id = s.id
		 GROUP BY s.id
		 ORDER BY s.started_at DESC
		 LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		slog.Error("admin chat list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()

	var sessions []sessionRow
	for rows.Next() {
		var s sessionRow
		if err := rows.Scan(&s.ID, &s.VisitorID, &s.Source, &s.StartedAt, &s.EndedAt, &s.MessageCount, &s.PurgedAt); err != nil {
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
	_ = h.Pool.QueryRow(r.Context(), `SELECT count(*) FROM bt.chat_sessions`).Scan(&total)

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
		StartedAt   string  `json:"started_at"`
		EndedAt     *string `json:"ended_at"`
		RetainUntil *string `json:"retain_until"`
		PurgedAt    *string `json:"purged_at"`
	}
	type messageRow struct {
		ID        int64   `json:"id"`
		Role      string  `json:"role"`
		Content   string  `json:"content"`
		ToolName  *string `json:"tool_name"`
		CreatedAt string  `json:"created_at"`
	}

	var s sessionDetail
	err := h.Pool.QueryRow(ctx,
		`SELECT id, visitor_id,
		        to_char(started_at,   'YYYY-MM-DD"T"HH24:MI:SSOF'),
		        to_char(ended_at,     'YYYY-MM-DD"T"HH24:MI:SSOF'),
		        to_char(retain_until, 'YYYY-MM-DD"T"HH24:MI:SSOF'),
		        to_char(purged_at,    'YYYY-MM-DD"T"HH24:MI:SSOF')
		 FROM bt.chat_sessions WHERE id = $1`, sessionID,
	).Scan(&s.ID, &s.VisitorID, &s.StartedAt, &s.EndedAt, &s.RetainUntil, &s.PurgedAt)
	if err != nil {
		httpx.WriteError(w, http.StatusNotFound, "not found")
		return
	}

	rows, err := h.Pool.Query(ctx,
		`SELECT id, role, content, tool_name,
		        to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SSOF')
		 FROM bt.chat_messages WHERE session_id = $1 ORDER BY created_at`, sessionID)
	if err != nil {
		slog.Error("admin chat messages", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()

	var messages []messageRow
	for rows.Next() {
		var m messageRow
		if err := rows.Scan(&m.ID, &m.Role, &m.Content, &m.ToolName, &m.CreatedAt); err != nil {
			slog.Error("admin chat messages scan", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		messages = append(messages, m)
	}
	if messages == nil {
		messages = []messageRow{}
	}

	// HIPAA §164.312(b): log PHI access.
	u, _ := appmw.AdminFromContext(ctx)
	admin.LogPHIAccess(ctx, h.Pool, r, u, "view_chat_session", "chat_session", sessionID)

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"session":  s,
		"messages": messages,
	})
}
