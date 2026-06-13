// phi_audit_helper.go — internal helper that writes one PHIAuditRecord after
// every successful PHI mutation.
//
// Retention
// =========
// PutAccessAudit uses AddDate(7, 0, 0) (comment: "§164.530(j) 6-year minimum;
// keep 7"). We apply the same 7-year retention here so both audit streams age
// out on the same schedule.
//
// Background context
// ==================
// auditPHI deliberately uses context.Background() + a short timeout rather
// than the caller's request context. Audit writes must succeed even when the
// caller's context has already been cancelled (e.g. client disconnect after a
// successful mutation). Failure is logged but never propagated — the parent
// operation has already succeeded.
package phi

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
)

const phiAuditTimeout = 5 * time.Second

// auditPHI records one PHI mutation event in DynamoDB bt-main.
//
// Parameters
//   - table     — logical entity name shown in the admin UI (e.g. "intakes")
//   - operation — "INSERT" | "UPDATE" | "DELETE"
//   - rowID     — stable identifier for the mutated row; MUST NOT contain PHI
//     (use submission UUIDs, session IDs, check UUIDs, hashes)
//   - actor     — identity performing the mutation (admin email, "system", etc.)
//   - newValues — safe metadata JSON string (statuses, counts, timestamps only).
//     MUST NOT contain PHI (no names, emails, phones, DOBs, message text).
//     Pass an empty string when there is no safe metadata to record.
//
// auditPHI is synchronous and called after the successful mutation so the audit
// row reflects a real state change. It never fails the parent operation.
func (s *Store) auditPHI(table, operation, rowID, actor, newValues string) {
	now := time.Now().UTC()
	rec := PHIAuditRecord{
		AuditID:     uuid.NewString(),
		TableName:   table,
		Operation:   operation,
		RowID:       rowID,
		Actor:       actor,
		NewValues:   newValues,
		CreatedAt:   now,
		RetainUntil: now.AddDate(7, 0, 0), // §164.530(j) 6-year minimum; keep 7 (matches PutAccessAudit)
	}

	ctx, cancel := context.WithTimeout(context.Background(), phiAuditTimeout)
	defer cancel()

	if err := s.PutPHIAudit(ctx, rec); err != nil {
		// Log the failure but never surface it to the caller.
		// rowID/actor are safe (UUIDs, hashes, emails); table/operation are enum-like.
		slog.Error("phi audit: failed to write phi audit row",
			"table", table,
			"operation", operation,
			"rowID", rowID,
			"actor", actor,
			"err", err,
		)
	}
}
