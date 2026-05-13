package admin

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"time"

	"github.com/brightertomorrowtherapy/bt-gateway/internal/phi"
	"github.com/google/uuid"
)

// auditWriteTimeout caps the detached background write. The request's own
// context has already returned to the client; we just need a deadline so a
// stuck backend doesn't pin the goroutine forever. Failures are slog'd but
// cannot be retried (HIPAA append-only — a missed row is investigated via
// logs and CloudWatch alarms).
const auditWriteTimeout = 5 * time.Second

// LogPHIAccess records a single admin PHI-access event.
// HIPAA §164.312(b): every admin read of PHI must be audited in the append-only log.
//
// Writes to DynamoDB bt-main (BAA-covered) — the Hostinger VPS Postgres
// no longer holds audit rows per project_hostinger_not_hipaa.
func LogPHIAccess(ctx context.Context, store *phi.Store, r *http.Request, u *User, action, resourceType, resourceID string) {
	LogPHIAccessBatch(ctx, store, r, u, action, resourceType, []string{resourceID})
}

// LogPHIAccessBatch records N PHI-access rows in one BatchWriteItem call.
// Used by list/CSV handlers that return many PHI records in a single
// response — collapsing N synchronous DDB writes into one async chunked one.
//
// All rows share the same admin/action/resource_type/ip/UA; only the
// resource_id differs. Empty ids slice → no-op.
func LogPHIAccessBatch(ctx context.Context, store *phi.Store, r *http.Request, u *User, action, resourceType string, resourceIDs []string) {
	if store == nil || u == nil || len(resourceIDs) == 0 {
		return
	}
	ipAddr := r.RemoteAddr
	if host, _, err := net.SplitHostPort(ipAddr); err == nil {
		ipAddr = host
	}
	ua := r.UserAgent()
	now := time.Now().UTC()
	retain := now.AddDate(10, 0, 0) // Nevada NRS 629.051 — 10y retention.

	rows := make([]phi.AccessAuditRecord, 0, len(resourceIDs))
	for _, rid := range resourceIDs {
		rows = append(rows, phi.AccessAuditRecord{
			AuditID:      uuid.NewString(),
			AdminUserID:  u.ID,
			AdminEmail:   u.Email,
			Action:       action,
			ResourceType: resourceType,
			ResourceID:   rid,
			IPAddress:    ipAddr,
			UserAgent:    ua,
			CreatedAt:    now,
			RetainUntil:  retain,
		})
	}

	// Detached context: the audit row must persist even if the client cancels.
	// Caller's ctx is intentionally NOT used as parent — only as a source of
	// the request-scoped values we already snapshotted above.
	_ = ctx
	bgCtx, cancel := context.WithTimeout(context.Background(), auditWriteTimeout)
	go func() {
		defer cancel()
		if err := store.PutAccessAuditBatch(bgCtx, rows); err != nil {
			slog.Error("admin_access_log: ddb batch put failed",
				"err", err, "action", action, "resource_type", resourceType, "n", len(rows))
		}
	}()
}
