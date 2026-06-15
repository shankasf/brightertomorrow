package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminAuditHandler handles HIPAA audit log + purge endpoints.
type AdminAuditHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store
}

// PHIAuditLog handles GET /admin/audit/phi — superadmin only.
// Reads from DynamoDB bt-main (BAA-covered). Pagination is page-based
// over a single DDB Query response; for deep paging the frontend should
// switch to cursor pagination via NextCursor in the response.
func (h *AdminAuditHandler) PHIAuditLog(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}
	page, limit := parsePage(r)
	offset := (page - 1) * limit

	type entry struct {
		ID        string  `json:"id"`
		EventTime string  `json:"event_time"`
		TableName string  `json:"table_name"`
		Operation string  `json:"operation"`
		RowID     string  `json:"row_id"`
		Actor     string  `json:"actor"`
		AppUser   *string `json:"app_user"`
	}

	// Over-fetch so page-based offsetting stays correct without forcing
	// the frontend to switch to cursor pagination immediately.
	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	res, err := h.PHI.ListPHIAudit(r.Context(), phi.PHIAuditFilter{
		Limit:  5000,
		Cursor: cursor,
	})
	if err != nil {
		slog.Error("admin phi audit log", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	total := len(res.Rows)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	slice := res.Rows[offset:end]

	entries := make([]entry, 0, len(slice))
	for _, r := range slice {
		var appUser *string
		if r.AppUser != "" {
			s := r.AppUser
			appUser = &s
		}
		entries = append(entries, entry{
			ID:        r.AuditID,
			EventTime: r.CreatedAt.UTC().Format(time.RFC3339),
			TableName: r.TableName,
			Operation: r.Operation,
			RowID:     r.RowID,
			Actor:     r.Actor,
			AppUser:   appUser,
		})
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"items":       entries,
		"total":       total,
		"page":        page,
		"limit":       limit,
		"next_cursor": res.NextCursor,
	})
}

// AdminAccessLog handles GET /admin/audit/access — superadmin only.
// Returns enriched rows including user_agent + structured details so the
// frontend can render human-readable sentences. Reads from DynamoDB.
func (h *AdminAuditHandler) AdminAccessLog(w http.ResponseWriter, r *http.Request) {
	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}
	page, limit := parsePage(r)
	offset := (page - 1) * limit

	type entry struct {
		ID           string          `json:"id"`
		EventTime    string          `json:"event_time"`
		AdminEmail   string          `json:"admin_email"`
		Action       string          `json:"action"`
		ResourceType string          `json:"resource_type"`
		ResourceID   *string         `json:"resource_id"`
		IPAddress    *string         `json:"ip_address"`
		UserAgent    *string         `json:"user_agent"`
		Details      json.RawMessage `json:"details"`
	}

	cursor := strings.TrimSpace(r.URL.Query().Get("cursor"))
	res, err := h.PHI.ListAccessAudit(r.Context(), phi.AccessAuditFilter{
		Limit:  5000,
		Cursor: cursor,
	})
	if err != nil {
		slog.Error("admin access log list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	total := len(res.Rows)
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	slice := res.Rows[offset:end]

	entries := make([]entry, 0, len(slice))
	for _, r := range slice {
		var rid, ip, ua *string
		if r.ResourceID != "" {
			s := r.ResourceID
			rid = &s
		}
		if r.IPAddress != "" {
			s := r.IPAddress
			ip = &s
		}
		if r.UserAgent != "" {
			s := r.UserAgent
			ua = &s
		}
		var details json.RawMessage
		if r.Details != "" {
			details = json.RawMessage(r.Details)
		}
		entries = append(entries, entry{
			ID:           r.AuditID,
			EventTime:    r.CreatedAt.UTC().Format(time.RFC3339),
			AdminEmail:   r.AdminEmail,
			Action:       r.Action,
			ResourceType: r.ResourceType,
			ResourceID:   rid,
			IPAddress:    ip,
			UserAgent:    ua,
			Details:      details,
		})
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"items":       entries,
		"total":       total,
		"page":        page,
		"limit":       limit,
		"next_cursor": res.NextCursor,
	})
}

// approxRowCount returns pg_class.reltuples for the given fully-qualified
// table name. Cheap (single index lookup) and accurate to within a few %
// after ANALYZE — adequate for paginated audit views where exactness is
// not load-bearing. Falls back to 0 on any error (UI degrades gracefully).
func approxRowCount(ctx context.Context, pool *pgxpool.Pool, qualified string) int {
	parts := strings.SplitN(qualified, ".", 2)
	if len(parts) != 2 {
		return 0
	}
	var n float64
	err := pool.QueryRow(ctx,
		`SELECT GREATEST(c.reltuples, 0)::float8
		   FROM pg_class c
		   JOIN pg_namespace n ON n.oid = c.relnamespace
		  WHERE n.nspname = $1 AND c.relname = $2`,
		parts[0], parts[1],
	).Scan(&n)
	if err != nil {
		return 0
	}
	return int(n)
}

// PurgeQueue handles GET /admin/audit/purge-queue — superadmin only.
func (h *AdminAuditHandler) PurgeQueue(w http.ResponseWriter, r *http.Request) {
	type item struct {
		Source      string `json:"source"`
		RowID       string `json:"row_id"`
		RetainUntil string `json:"retain_until"`
	}

	rows, err := h.Pool.Query(r.Context(),
		`SELECT source, row_id, to_char(retain_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
		 FROM bt.phi_due_for_purge ORDER BY retain_until`)
	if err != nil {
		slog.Error("admin purge queue", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()

	var items []item
	for rows.Next() {
		var i item
		if err := rows.Scan(&i.Source, &i.RowID, &i.RetainUntil); err != nil {
			slog.Error("admin purge queue scan", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		items = append(items, i)
	}
	if items == nil {
		items = []item{}
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

// PurgeContact handles POST /admin/audit/purge/contact/:id — superadmin only.
// Calls the bt.anonymise_contact procedure (Nevada NRS 603A right-to-erasure).
func (h *AdminAuditHandler) PurgeContact(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseInt(chi.URLParam(r, "id"), 10, 64)
	if err != nil {
		httpx.WriteValidationError(w, "invalid id")
		return
	}

	if _, err := h.Pool.Exec(r.Context(), `CALL bt.anonymise_contact($1)`, id); err != nil {
		slog.Error("admin purge contact", "err", err, "id", id)
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	u, _ := appmw.AdminFromContext(r.Context())
	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "purge_contact", "contact_submission", strconv.FormatInt(id, 10))

	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}

// PurgeChat handles POST /admin/audit/purge/chat/:id — superadmin only.
//
// A chat session has two stores: the Postgres pointer/metadata rows
// (chat_sessions + the legacy chat_messages table) and the DynamoDB
// CHAT#<session>/TURN# items that hold the actual message bodies (PHI of
// record). Right-to-erasure must clear BOTH — the Postgres proc cannot reach
// DynamoDB, so we follow it with DeleteChatSession. If the DDB side fails we
// surface a 500 so the operator knows the erasure is incomplete.
func (h *AdminAuditHandler) PurgeChat(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")
	if sessionID == "" {
		httpx.WriteValidationError(w, "missing session id")
		return
	}

	if _, err := h.Pool.Exec(r.Context(), `CALL bt.anonymise_chat_session($1)`, sessionID); err != nil {
		slog.Error("admin purge chat", "err", err, "session_id", sessionID)
		httpx.WriteError(w, http.StatusInternalServerError, "purge failed")
		return
	}

	if h.PHI != nil {
		if _, err := h.PHI.DeleteChatSession(r.Context(), sessionID); err != nil {
			slog.Error("admin purge chat: delete ddb turns", "err", err, "session_id", sessionID)
			httpx.WriteError(w, http.StatusInternalServerError, "purge incomplete: message bodies not deleted")
			return
		}
	}

	u, _ := appmw.AdminFromContext(r.Context())
	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "purge_chat_session", "chat_session", sessionID)

	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
