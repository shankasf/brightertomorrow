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
	"github.com/go-chi/chi/v5"
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
	// ADDITIVE — present once a human has reviewed whether this escalation
	// was the right call. Absent for unreviewed rows.
	EscalationVerdict *callbackEscalationVerdictJSON `json:"escalation_verdict,omitempty"`
}

// callbackEscalationVerdictJSON is the row-level shape of a stored escalation
// verdict. No PHI (the note is reviewer commentary, capped + PHI-free).
type callbackEscalationVerdictJSON struct {
	Appropriate bool   `json:"appropriate"`
	Note        string `json:"note,omitempty"`
	VerdictBy   string `json:"verdict_by,omitempty"`
	VerdictAt   string `json:"verdict_at,omitempty"`
}

// escalationVerdictRequest is the body for POST .../escalation-verdict.
type escalationVerdictRequest struct {
	Appropriate bool   `json:"appropriate"`
	Note        string `json:"note,omitempty"` // max 500 chars; no PHI
}

// PutEscalationVerdict handles POST /admin/api/callbacks/{id}/escalation-verdict.
// Superadmin-only (enforced at the router level). Records whether the escalation
// (handoff to a human) was appropriate or a false positive.
func (h *AdminCallbacksHandler) PutEscalationVerdict(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		httpx.WriteValidationError(w, "id is required")
		return
	}

	u, ok := appmw.AdminFromContext(r.Context())
	if !ok {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized")
		return
	}
	admin.LogPHIAccess(r.Context(), h.PHI, r, u, "put_escalation_verdict", "callback_requests", id)

	var req escalationVerdictRequest
	if err := httpx.ReadJSON(w, r, &req); err != nil {
		httpx.WriteValidationError(w, "invalid JSON")
		return
	}
	if len(req.Note) > 500 {
		httpx.WriteValidationError(w, "note must be 500 characters or fewer")
		return
	}

	verdict := phi.CallbackEscalationVerdict{
		CallbackID:  id,
		Appropriate: req.Appropriate,
		Note:        req.Note,
		VerdictBy:   u.Email,
		VerdictAt:   time.Now().UTC(),
	}

	if err := h.PHI.PutEscalationVerdict(r.Context(), verdict); err != nil {
		slog.Error("admin callbacks: put escalation verdict", "id", id, "err", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal server error")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, map[string]string{"status": "ok"})
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

	// Attach any human escalation verdicts so the UI reflects prior reviews on
	// reload. One batched read keyed by callback ID — no N+1. Best-effort: a
	// lookup failure just leaves rows unreviewed rather than failing the list.
	if len(out) > 0 {
		ids := make([]string, len(out))
		for i, row := range out {
			ids[i] = row.ID
		}
		if verdicts, vErr := h.PHI.BatchGetEscalationVerdicts(r.Context(), ids); vErr != nil {
			slog.Error("admin callbacks: batch get escalation verdicts", "err", vErr)
		} else {
			for i := range out {
				if v := verdicts[out[i].ID]; v != nil {
					out[i].EscalationVerdict = &callbackEscalationVerdictJSON{
						Appropriate: v.Appropriate,
						Note:        v.Note,
						VerdictBy:   v.VerdictBy,
						VerdictAt:   v.VerdictAt.UTC().Format(time.RFC3339),
					}
				}
			}
		}
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
