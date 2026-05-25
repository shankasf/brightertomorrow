// intake_list.go — DynamoDB list + update helpers for intake records.
//
// Why in-memory filtering (same pattern as callbacks.go)
// ======================================================
// At current scale (tens to thousands of rows/year) a full GSI scan is
// cheap and avoids the complexity of filter-expression pagination. The GSI
// query returns full items (pointer + PHI together), so PHI hydration via
// BatchGetIntakes is no longer needed for the admin list view.
//
// When the table grows beyond ~50k intake records, swap the admin UI to a
// nextCursor model and push date-range filtering into a KeyConditionExpression
// range key query on a dedicated GSI (e.g. GSI2PK=ENTITY#INTAKE, GSI2SK=createdAt).
package phi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// IntakeFilter narrows ListIntakePointers. Empty / zero values mean "no filter".
type IntakeFilter struct {
	// From / To filter on CreatedAt (inclusive).
	From *time.Time
	To   *time.Time
	// Source is an exact-match filter on the source field (e.g. "chat-agent").
	// The admin handler translates UI values like "chatbot"/"voice"/"website"
	// into one or more source strings before calling.
	Source string
	// Status matches CoverageStatus exactly when set (e.g. "eligible").
	Status string
	// SearchText is a case-insensitive substring match across
	// first_name + last_name + email + phone.
	SearchText string
	// Limit is the max number of DDB items to scan before in-memory filter.
	// 0 defaults to 10000.
	Limit int
}

// ListIntakePointers returns intake records most-recent-first, optionally
// filtered. Filters run in-memory after the DDB Query. Callers paginate the
// returned slice.
//
// Returns (rows, scanned) — scanned is the DDB item count BEFORE the
// in-memory filter, which lets the admin UI show "filtered N of M" if needed.
func (s *Store) ListIntakePointers(ctx context.Context, f IntakeFilter) ([]IntakeRecord, int, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	limit := f.Limit
	if limit <= 0 || limit > 10000 {
		limit = 10000
	}

	// If a status filter is specified, query that one status bucket on GSI1.
	// Otherwise query all known status values and merge — at current scale
	// (dozens of rows) this is fast and avoids a Scan.
	var allItems []map[string]ddbtypes.AttributeValue

	if f.Status != "" {
		items, err := s.queryGSI1Status(ctx, f.Status, int32(limit))
		if err != nil {
			return nil, 0, fmt.Errorf("phi: list intake pointers: %w", err)
		}
		allItems = items
	} else {
		statuses := []string{
			StatusEligible, StatusSelfPay, StatusNeedsReview, StatusVerificationError,
		}
		seen := make(map[string]struct{})
		for _, st := range statuses {
			items, err := s.queryGSI1Status(ctx, st, int32(limit))
			if err != nil {
				return nil, 0, fmt.Errorf("phi: list intake pointers (status=%s): %w", st, err)
			}
			for _, it := range items {
				if sk, ok := it["SK"].(*ddbtypes.AttributeValueMemberS); ok {
					if _, dup := seen[sk.Value]; !dup {
						seen[sk.Value] = struct{}{}
						allItems = append(allItems, it)
					}
				}
			}
		}
	}

	scanned := len(allItems)
	needle := strings.ToLower(strings.TrimSpace(f.SearchText))

	rows := make([]IntakeRecord, 0, scanned)
	for _, it := range allItems {
		var r IntakeRecord
		if err := attributevalue.UnmarshalMap(it, &r); err != nil {
			return nil, scanned, fmt.Errorf("phi: unmarshal intake (list): %w", err)
		}

		// Date range filter.
		if f.From != nil && r.CreatedAt.Before(*f.From) {
			continue
		}
		if f.To != nil && r.CreatedAt.After(*f.To) {
			continue
		}
		// Source filter.
		if f.Source != "" && r.Source != f.Source {
			continue
		}
		// Free-text filter.
		if needle != "" {
			hay := strings.ToLower(r.FirstName + " " + r.LastName + " " + r.Email + " " + r.Phone)
			if !strings.Contains(hay, needle) {
				continue
			}
		}
		rows = append(rows, r)
	}

	// Sort descending by CreatedAt — DDB returns per-status bucket in desc
	// order already, but the merge of multiple statuses scrambles the order.
	sortIntakeDesc(rows)

	return rows, scanned, nil
}

// queryGSI1Status queries a single status bucket on GSI1 and returns raw items.
func (s *Store) queryGSI1Status(ctx context.Context, status string, limit int32) ([]map[string]ddbtypes.AttributeValue, error) {
	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		IndexName:              aws.String(s.gsi1Name),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": &ddbtypes.AttributeValueMemberS{Value: statusGSI1PK(status)},
		},
		ScanIndexForward: aws.Bool(false), // DESC newest first
		Limit:            aws.Int32(limit),
	})
	if err != nil {
		return nil, err
	}
	return out.Items, nil
}

// sortIntakeDesc sorts rows newest-first in place using insertion sort.
// The input is already nearly sorted (per-status buckets come in order)
// so insertion sort converges quickly in practice.
func sortIntakeDesc(rows []IntakeRecord) {
	for i := 1; i < len(rows); i++ {
		for j := i; j > 0 && rows[j].CreatedAt.After(rows[j-1].CreatedAt); j-- {
			rows[j], rows[j-1] = rows[j-1], rows[j]
		}
	}
}

// WorkflowStatuses is the canonical closed set of workflow status values.
// The zero value (absent on old records) is treated as "new" at the read layer.
var WorkflowStatuses = map[string]struct{}{
	"new":                  {},
	"in_review":            {},
	"approved":             {},
	"scheduled":            {},
	"reschedule_requested": {},
	"cancel_requested":     {},
	"cancelled":            {},
	"no_show":              {},
	"completed":            {},
	"rejected":             {},
	"archived":             {},
}

// IsValidWorkflowStatus reports whether s is a member of the canonical enum.
func IsValidWorkflowStatus(s string) bool {
	_, ok := WorkflowStatuses[s]
	return ok
}

// UpdateIntakeWorkflowStatus sets the workflow status on an existing DDB intake
// record. Mirrors UpdateIntakeAppointment: keyed by PK/SK with a
// ConditionExpression so callers get ErrNotFound on a missing record rather than
// a silent no-op. `by` is the admin identity (email or ID) for the audit trail.
func (s *Store) UpdateIntakeWorkflowStatus(
	ctx context.Context,
	emailHash, submissionUUID, status, by string,
) error {
	if emailHash == "" || submissionUUID == "" {
		return fmt.Errorf("phi: emailHash and submissionUUID are required")
	}
	if !IsValidWorkflowStatus(status) {
		return fmt.Errorf("phi: invalid workflow status %q", status)
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	now := time.Now().UTC()
	attrStatus, err := attributevalue.Marshal(status)
	if err != nil {
		return fmt.Errorf("phi: marshal workflow_status: %w", err)
	}
	attrTime, err := attributevalue.Marshal(now)
	if err != nil {
		return fmt.Errorf("phi: marshal workflow_status_updated_at: %w", err)
	}
	attrBy, err := attributevalue.Marshal(by)
	if err != nil {
		return fmt.Errorf("phi: marshal workflow_status_by: %w", err)
	}

	_, err = s.ddb.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.tableName),
		Key: map[string]ddbtypes.AttributeValue{
			"PK": &ddbtypes.AttributeValueMemberS{Value: patientPK(emailHash)},
			"SK": &ddbtypes.AttributeValueMemberS{Value: intakeSK(submissionUUID)},
		},
		UpdateExpression: aws.String(
			"SET workflowStatus = :s, workflowStatusUpdatedAt = :t, workflowStatusBy = :b",
		),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":s": attrStatus,
			":t": attrTime,
			":b": attrBy,
		},
		ConditionExpression: aws.String("attribute_exists(PK) AND attribute_exists(SK)"),
	})
	if err != nil {
		var cond *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &cond) {
			return ErrNotFound
		}
		return fmt.Errorf("phi: update intake workflow status: %w", err)
	}
	return nil
}

// UpdateIntakeAppointment sets AppointmentTime and TherapistStaffID on an
// existing DDB intake record. Used by the migration tool to backfill data
// from the Postgres intake_pointers table into pre-existing DDB items.
// Idempotent — safe to re-run.
//
// Returns ErrNotFound if the DDB record does not exist.
func (s *Store) UpdateIntakeAppointment(
	ctx context.Context,
	emailHash, submissionUUID string,
	appointmentTime time.Time,
	therapistStaffID int,
) error {
	if emailHash == "" || submissionUUID == "" {
		return fmt.Errorf("phi: emailHash and submissionUUID are required")
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	attrTime, err := attributevalue.Marshal(appointmentTime.UTC())
	if err != nil {
		return fmt.Errorf("phi: marshal appointment_time: %w", err)
	}
	attrStaff, err := attributevalue.Marshal(therapistStaffID)
	if err != nil {
		return fmt.Errorf("phi: marshal therapist_staff_id: %w", err)
	}

	_, err = s.ddb.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.tableName),
		Key: map[string]ddbtypes.AttributeValue{
			"PK": &ddbtypes.AttributeValueMemberS{Value: patientPK(emailHash)},
			"SK": &ddbtypes.AttributeValueMemberS{Value: intakeSK(submissionUUID)},
		},
		UpdateExpression: aws.String("SET appointmentTime = :at, therapistStaffId = :ts"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":at": attrTime,
			":ts": attrStaff,
		},
		ConditionExpression: aws.String("attribute_exists(PK) AND attribute_exists(SK)"),
	})
	if err != nil {
		var cond *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &cond) {
			return ErrNotFound
		}
		return fmt.Errorf("phi: update intake appointment: %w", err)
	}
	return nil
}
