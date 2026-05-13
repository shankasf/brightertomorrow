package handlers

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/go-chi/chi/v5"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminAuditHandler handles HIPAA audit log + purge endpoints.
type AdminAuditHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store
}

// PHIAuditLog handles GET /admin/audit/phi — superadmin only.
// Reading the phi_audit_log is itself a PHI access event and must be logged.
func (h *AdminAuditHandler) PHIAuditLog(w http.ResponseWriter, r *http.Request) {
	page, limit := parsePage(r)
	offset := (page - 1) * limit

	type entry struct {
		ID         int64   `json:"id"`
		EventTime  string  `json:"event_time"`
		TableName  string  `json:"table_name"`
		Operation  string  `json:"operation"`
		RowID      string  `json:"row_id"`
		Actor      string  `json:"actor"`
		AppUser    *string `json:"app_user"`
	}

	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, to_char(event_time,'YYYY-MM-DD"T"HH24:MI:SSOF'),
		        table_name, operation, row_id, actor, app_user
		 FROM bt.phi_audit_log
		 ORDER BY event_time DESC
		 LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		slog.Error("admin phi audit log", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()

	var entries []entry
	for rows.Next() {
		var e entry
		if err := rows.Scan(&e.ID, &e.EventTime, &e.TableName, &e.Operation, &e.RowID, &e.Actor, &e.AppUser); err != nil {
			slog.Error("admin phi audit scan", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []entry{}
	}

	// Approximate count from pg_class.reltuples — phi_audit_log is append-
	// heavy and grows unboundedly; an exact count(*) would be a full scan
	// on every audit page load. ANALYZE keeps this within a few percent
	// of truth, which is plenty for pagination UI.
	total := approxRowCount(r.Context(), h.Pool, "bt.phi_audit_log")

	// LogAdminActivity middleware already records view_phi_audit_log for this
	// request — no need to call LogPHIAccess here (would be a duplicate row).

	httpx.WriteJSON(w, http.StatusOK, pageResponse(entries, total, page, limit))
}

// AdminAccessLog handles GET /admin/audit/access — superadmin only.
// Returns enriched rows including user_agent, details JSONB (which carries
// method, path, and query) so the frontend can render human-readable sentences.
func (h *AdminAuditHandler) AdminAccessLog(w http.ResponseWriter, r *http.Request) {
	page, limit := parsePage(r)
	offset := (page - 1) * limit

	type entry struct {
		ID           int64           `json:"id"`
		EventTime    string          `json:"event_time"`
		AdminEmail   string          `json:"admin_email"`
		Action       string          `json:"action"`
		ResourceType string          `json:"resource_type"`
		ResourceID   *string         `json:"resource_id"`
		IPAddress    *string         `json:"ip_address"`
		UserAgent    *string         `json:"user_agent"`
		Details      json.RawMessage `json:"details"`
	}

	rows, err := h.Pool.Query(r.Context(),
		`SELECT id, to_char(event_time,'YYYY-MM-DD"T"HH24:MI:SSOF'),
		        admin_email, action, resource_type, resource_id, ip_address::text,
		        user_agent, details
		 FROM bt.admin_access_log
		 ORDER BY event_time DESC
		 LIMIT $1 OFFSET $2`, limit, offset)
	if err != nil {
		slog.Error("admin access log list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}
	defer rows.Close()

	var entries []entry
	for rows.Next() {
		var e entry
		var detailsBytes []byte
		if err := rows.Scan(&e.ID, &e.EventTime, &e.AdminEmail, &e.Action, &e.ResourceType,
			&e.ResourceID, &e.IPAddress, &e.UserAgent, &detailsBytes); err != nil {
			slog.Error("admin access log scan", "err", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
			return
		}
		if len(detailsBytes) > 0 {
			e.Details = json.RawMessage(detailsBytes)
		}
		entries = append(entries, e)
	}
	if entries == nil {
		entries = []entry{}
	}

	total := approxRowCount(r.Context(), h.Pool, "bt.admin_access_log")

	httpx.WriteJSON(w, http.StatusOK, pageResponse(entries, total, page, limit))
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
		`SELECT source, row_id, to_char(retain_until,'YYYY-MM-DD"T"HH24:MI:SSOF')
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
func (h *AdminAuditHandler) PurgeChat(w http.ResponseWriter, r *http.Request) {
	sessionID := chi.URLParam(r, "id")

	if _, err := h.Pool.Exec(r.Context(), `CALL bt.anonymise_chat_session($1)`, sessionID); err != nil {
		slog.Error("admin purge chat", "err", err, "session_id", sessionID)
		httpx.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}

	u, _ := appmw.AdminFromContext(r.Context())
	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "purge_chat_session", "chat_session", sessionID)

	httpx.WriteJSON(w, http.StatusOK, map[string]bool{"ok": true})
}
