package handlers

import (
	"log/slog"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/admin"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/httpx"
	appmw "github.com/brightertomorrowtherapy/bt-gateway/internal/middleware"
	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/jackc/pgx/v5/pgxpool"
)

// AdminCallbacksHandler serves /admin/api/callbacks — list of callback
// requests now stored in DynamoDB bt-main (PATIENT#callback-<uuid> rows,
// GSI1PK = ENTITY#CALLBACK). Postgres `bt.callback_requests` is no longer
// the source of truth; this handler reads via phi.Store.
//
// Pool is still here only for writing the §164.312(b) PHI-access audit
// row (admin_access_log lives on Postgres until task #19 moves it too).
type AdminCallbacksHandler struct {
	Pool *pgxpool.Pool
	PHI  *phi.Store
}

type callbackRow struct {
	ID        string `json:"id"`
	FirstName string `json:"first_name"`
	LastName  string `json:"last_name"`
	Phone     string `json:"phone"`
	Reason    string `json:"reason"`
	Source    string `json:"source"`
	CreatedAt string `json:"created_at"`
}

// List handles GET /admin/api/callbacks. Pagination is in-memory after a
// DDB Query — see phi.ListCallbacks for the cost/scale envelope (cheap
// for tens of thousands of rows; switch to cursor pagination if it grows
// past that).
func (h *AdminCallbacksHandler) List(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _ := strconv.Atoi(q.Get("limit"))
	if limit < 1 || limit > 500 {
		limit = 200
	}
	page, _ := strconv.Atoi(q.Get("page"))
	if page < 1 {
		page = 1
	}
	offset := (page - 1) * limit

	if h.PHI == nil {
		httpx.WriteError(w, http.StatusInternalServerError, "phi store not configured")
		return
	}

	source := strings.TrimSpace(q.Get("source"))
	if source == "all" {
		source = ""
	}
	search := strings.TrimSpace(q.Get("q"))

	rows, _, err := h.PHI.ListCallbacks(r.Context(), phi.CallbackFilter{
		Source:     source,
		SearchText: search,
		Limit:      10000,
	})
	if err != nil {
		slog.Error("admin callbacks: phi list", "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	total := len(rows)
	// phi.ListCallbacks already returns DESC by createdAt, but sort again
	// in case future filters change the ordering invariant.
	sort.Slice(rows, func(i, j int) bool {
		return rows[i].CreatedAt.After(rows[j].CreatedAt)
	})

	start := offset
	end := offset + limit
	if start > total {
		start = total
	}
	if end > total {
		end = total
	}
	pageRows := rows[start:end]

	out := make([]callbackRow, 0, len(pageRows))
	for _, r := range pageRows {
		out = append(out, callbackRow{
			ID:        r.CallbackID,
			FirstName: r.FirstName,
			LastName:  r.LastName,
			Phone:     r.Phone,
			Reason:    r.Reason,
			Source:    r.Source,
			CreatedAt: r.CreatedAt.UTC().Format(time.RFC3339),
		})
	}

	// HIPAA §164.312(b) — record one access_log row per callback viewed,
	// so we can later answer "which admin saw which callback request, and
	// when". Reason (the visitor's free-text) is the sensitive bit; phone +
	// name are linkable PHI when paired with a healthcare context.
	// One batched INSERT in a detached goroutine — no rows dropped.
	if u, ok := appmw.AdminFromContext(r.Context()); ok && h.Pool != nil && len(out) > 0 {
		ids := make([]string, 0, len(out))
		for _, row := range out {
			ids = append(ids, row.ID)
		}
		admin.LogPHIAccessBatch(r.Context(), h.PHI, r, u,
			"view_callbacks_list", "callback_requests", ids)
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]any{
		"items": out,
		"total": total,
		"page":  page,
		"limit": limit,
	})
}
