// audit.go — DynamoDB persistence for HIPAA audit logs.
//
// Why DynamoDB, not Postgres
// ==========================
// bt.admin_access_log and bt.phi_audit_log hold audit rows that reference
// PHI record IDs, admin identities, and IP addresses. Hostinger Postgres is
// not BAA-covered; DynamoDB bt-main is CMK-encrypted and BAA-covered.
// §164.312(b) requires an audit control mechanism — every PHI access event
// must land in the covered entity's audit store.
//
// Key design
// ==========
// Two record types share the same table using SK prefixes.
//
// ACCESS LOG (admin activity / PHI-access events):
//   PK     = "AUDIT#ACCESS#<YYYY-MM-DD>"    — day bucket avoids hot partition
//   SK     = "ACCESS#<RFC3339Nano>#<auditID>"
//   GSI1PK = "ENTITY#AUDIT_ACCESS"
//   GSI1SK = "<RFC3339Nano>#<auditID>"       — cross-day listing, newest-first
//
// PHI TRIGGER LOG (Postgres trigger writes; migrated from phi_audit_log):
//   PK     = "AUDIT#PHI#<YYYY-MM-DD>"
//   SK     = "PHI#<RFC3339Nano>#<auditID>"
//   GSI1PK = "ENTITY#AUDIT_PHI"
//   GSI1SK = "<RFC3339Nano>#<auditID>"
//
// Cursor pagination via ExclusiveStartKey keeps every page O(page_size).
package phi

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

const (
	auditAccessGSI1PK = "ENTITY#AUDIT_ACCESS"
	auditPHIGSI1PK    = "ENTITY#AUDIT_PHI"
)

// AccessAuditRecord is one admin PHI-access event (migrated from bt.admin_access_log).
type AccessAuditRecord struct {
	AuditID      string    `dynamodbav:"auditId"`
	AdminUserID  int64     `dynamodbav:"adminUserId"`
	AdminEmail   string    `dynamodbav:"adminEmail"`
	Action       string    `dynamodbav:"action"`
	ResourceType string    `dynamodbav:"resourceType"`
	ResourceID   string    `dynamodbav:"resourceId,omitempty"`
	IPAddress    string    `dynamodbav:"ipAddress,omitempty"`
	UserAgent    string    `dynamodbav:"userAgent,omitempty"`
	Details      string    `dynamodbav:"details,omitempty"` // JSON string
	CreatedAt    time.Time `dynamodbav:"createdAt"`
	RetainUntil  time.Time `dynamodbav:"retainUntil"`
}

// PHIAuditRecord is one Postgres trigger audit event (migrated from bt.phi_audit_log).
type PHIAuditRecord struct {
	AuditID    string    `dynamodbav:"auditId"`
	TableName  string    `dynamodbav:"tableName"`
	Operation  string    `dynamodbav:"operation"` // INSERT | UPDATE | DELETE
	RowID      string    `dynamodbav:"rowId"`
	Actor      string    `dynamodbav:"actor"`
	AppUser    string    `dynamodbav:"appUser,omitempty"`
	OldValues  string    `dynamodbav:"oldValues,omitempty"` // JSON string
	NewValues  string    `dynamodbav:"newValues,omitempty"` // JSON string
	CreatedAt  time.Time `dynamodbav:"createdAt"`
	RetainUntil time.Time `dynamodbav:"retainUntil"`
}

// --- key helpers ---

func auditAccessPK(t time.Time) string {
	return "AUDIT#ACCESS#" + t.UTC().Format("2006-01-02")
}
func auditAccessSK(t time.Time, id string) string {
	return "ACCESS#" + t.UTC().Format(time.RFC3339Nano) + "#" + id
}

func auditPHIPK(t time.Time) string {
	return "AUDIT#PHI#" + t.UTC().Format("2006-01-02")
}
func auditPHISK(t time.Time, id string) string {
	return "PHI#" + t.UTC().Format(time.RFC3339Nano) + "#" + id
}

// --- PutAccessAudit / PutAccessAuditBatch ---

// PutAccessAudit writes one admin access audit row.
// Fire-and-forget callers should call this from a goroutine with a
// background context; errors are returned so the caller can slog them.
func (s *Store) PutAccessAudit(ctx context.Context, r AccessAuditRecord) error {
	if r.AuditID == "" {
		return fmt.Errorf("phi: AccessAuditRecord.AuditID required")
	}
	if r.CreatedAt.IsZero() {
		r.CreatedAt = time.Now().UTC()
	}
	if r.RetainUntil.IsZero() {
		r.RetainUntil = r.CreatedAt.AddDate(7, 0, 0) // §164.530(j) 6-year minimum; keep 7
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	item, err := attributevalue.MarshalMap(r)
	if err != nil {
		return fmt.Errorf("phi: marshal access audit: %w", err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: auditAccessPK(r.CreatedAt)}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: auditAccessSK(r.CreatedAt, r.AuditID)}
	item["GSI1PK"] = &ddbtypes.AttributeValueMemberS{Value: auditAccessGSI1PK}
	item["GSI1SK"] = &ddbtypes.AttributeValueMemberS{
		Value: r.CreatedAt.UTC().Format(time.RFC3339Nano) + "#" + r.AuditID,
	}

	_, err = s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("phi: put access audit: %w", err)
	}
	return nil
}

// PutAccessAuditBatch writes up to 25 access audit rows in one BatchWriteItem call.
// Larger slices must be chunked by the caller (or use the internal batcher below).
// Retries UnprocessedItems with exponential backoff.
func (s *Store) PutAccessAuditBatch(ctx context.Context, rows []AccessAuditRecord) error {
	if len(rows) == 0 {
		return nil
	}
	// Chunk into groups of 25 (DDB BatchWriteItem hard limit).
	for start := 0; start < len(rows); start += 25 {
		end := start + 25
		if end > len(rows) {
			end = len(rows)
		}
		if err := s.putAccessAuditChunk(ctx, rows[start:end]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) putAccessAuditChunk(ctx context.Context, rows []AccessAuditRecord) error {
	writes := make([]ddbtypes.WriteRequest, 0, len(rows))
	for _, r := range rows {
		if r.CreatedAt.IsZero() {
			r.CreatedAt = time.Now().UTC()
		}
		if r.RetainUntil.IsZero() {
			r.RetainUntil = r.CreatedAt.AddDate(7, 0, 0)
		}
		item, err := attributevalue.MarshalMap(r)
		if err != nil {
			return fmt.Errorf("phi: marshal access audit batch item: %w", err)
		}
		item["PK"] = &ddbtypes.AttributeValueMemberS{Value: auditAccessPK(r.CreatedAt)}
		item["SK"] = &ddbtypes.AttributeValueMemberS{Value: auditAccessSK(r.CreatedAt, r.AuditID)}
		item["GSI1PK"] = &ddbtypes.AttributeValueMemberS{Value: auditAccessGSI1PK}
		item["GSI1SK"] = &ddbtypes.AttributeValueMemberS{
			Value: r.CreatedAt.UTC().Format(time.RFC3339Nano) + "#" + r.AuditID,
		}
		writes = append(writes, ddbtypes.WriteRequest{
			PutRequest: &ddbtypes.PutRequest{Item: item},
		})
	}

	pending := writes
	for retry := 0; retry < 6 && len(pending) > 0; retry++ {
		bctx, bcancel := context.WithTimeout(ctx, s.timeout)
		resp, err := s.ddb.BatchWriteItem(bctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]ddbtypes.WriteRequest{s.tableName: pending},
		})
		bcancel()
		if err != nil {
			return fmt.Errorf("phi: batch write access audit: %w", err)
		}
		pending = nil
		if resp != nil {
			if u, ok := resp.UnprocessedItems[s.tableName]; ok && len(u) > 0 {
				pending = u
			}
		}
		if len(pending) == 0 {
			break
		}
		sleep := time.Duration(50<<retry) * time.Millisecond
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(sleep):
		}
	}
	if len(pending) > 0 {
		return fmt.Errorf("phi: batch write access audit: %d items unprocessed after retries", len(pending))
	}
	return nil
}

// --- PutPHIAudit / PutPHIAuditBatch ---

// PutPHIAudit writes one PHI trigger audit row.
func (s *Store) PutPHIAudit(ctx context.Context, r PHIAuditRecord) error {
	if r.AuditID == "" {
		return fmt.Errorf("phi: PHIAuditRecord.AuditID required")
	}
	if r.CreatedAt.IsZero() {
		r.CreatedAt = time.Now().UTC()
	}
	if r.RetainUntil.IsZero() {
		r.RetainUntil = r.CreatedAt.AddDate(7, 0, 0)
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	item, err := attributevalue.MarshalMap(r)
	if err != nil {
		return fmt.Errorf("phi: marshal phi audit: %w", err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: auditPHIPK(r.CreatedAt)}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: auditPHISK(r.CreatedAt, r.AuditID)}
	item["GSI1PK"] = &ddbtypes.AttributeValueMemberS{Value: auditPHIGSI1PK}
	item["GSI1SK"] = &ddbtypes.AttributeValueMemberS{
		Value: r.CreatedAt.UTC().Format(time.RFC3339Nano) + "#" + r.AuditID,
	}

	_, err = s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("phi: put phi audit: %w", err)
	}
	return nil
}

// PutPHIAuditBatch writes PHI audit rows in chunks of 25.
func (s *Store) PutPHIAuditBatch(ctx context.Context, rows []PHIAuditRecord) error {
	if len(rows) == 0 {
		return nil
	}
	for start := 0; start < len(rows); start += 25 {
		end := start + 25
		if end > len(rows) {
			end = len(rows)
		}
		if err := s.putPHIAuditChunk(ctx, rows[start:end]); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) putPHIAuditChunk(ctx context.Context, rows []PHIAuditRecord) error {
	writes := make([]ddbtypes.WriteRequest, 0, len(rows))
	for _, r := range rows {
		if r.CreatedAt.IsZero() {
			r.CreatedAt = time.Now().UTC()
		}
		if r.RetainUntil.IsZero() {
			r.RetainUntil = r.CreatedAt.AddDate(7, 0, 0)
		}
		item, err := attributevalue.MarshalMap(r)
		if err != nil {
			return fmt.Errorf("phi: marshal phi audit batch item: %w", err)
		}
		item["PK"] = &ddbtypes.AttributeValueMemberS{Value: auditPHIPK(r.CreatedAt)}
		item["SK"] = &ddbtypes.AttributeValueMemberS{Value: auditPHISK(r.CreatedAt, r.AuditID)}
		item["GSI1PK"] = &ddbtypes.AttributeValueMemberS{Value: auditPHIGSI1PK}
		item["GSI1SK"] = &ddbtypes.AttributeValueMemberS{
			Value: r.CreatedAt.UTC().Format(time.RFC3339Nano) + "#" + r.AuditID,
		}
		writes = append(writes, ddbtypes.WriteRequest{
			PutRequest: &ddbtypes.PutRequest{Item: item},
		})
	}

	pending := writes
	for retry := 0; retry < 6 && len(pending) > 0; retry++ {
		bctx, bcancel := context.WithTimeout(ctx, s.timeout)
		resp, err := s.ddb.BatchWriteItem(bctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]ddbtypes.WriteRequest{s.tableName: pending},
		})
		bcancel()
		if err != nil {
			return fmt.Errorf("phi: batch write phi audit: %w", err)
		}
		pending = nil
		if resp != nil {
			if u, ok := resp.UnprocessedItems[s.tableName]; ok && len(u) > 0 {
				pending = u
			}
		}
		if len(pending) == 0 {
			break
		}
		sleep := time.Duration(50<<retry) * time.Millisecond
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(sleep):
		}
	}
	if len(pending) > 0 {
		return fmt.Errorf("phi: batch write phi audit: %d items unprocessed after retries", len(pending))
	}
	return nil
}

// --- List queries ---

// AccessAuditFilter narrows ListAccessAudit results. Zero values mean no filter.
type AccessAuditFilter struct {
	From         time.Time // inclusive lower bound on CreatedAt
	To           time.Time // inclusive upper bound on CreatedAt
	AdminEmail   string    // exact match
	Action       string    // exact match
	ResourceType string    // exact match
	SearchText   string    // substring across action/resource_type/resource_id/admin_email
	Limit        int       // max rows to return from DDB before in-memory filter
	// Cursor for DDB ExclusiveStartKey. Pass the last-returned NextCursor to
	// page forward. Empty string = start from beginning.
	Cursor string
}

// ListAccessAuditResult is returned by ListAccessAudit.
type ListAccessAuditResult struct {
	Rows       []AccessAuditRecord
	Scanned    int    // DDB items read before in-memory filter
	NextCursor string // opaque; pass as Cursor in next call; empty = no more pages
}

// ListAccessAudit queries the GSI1 for all access audit rows, applies
// in-memory filters, and returns results newest-first.
//
// For large result sets use Cursor pagination. Each call queries up to
// Limit (default 500, max 5000) items from DDB, then applies in-memory
// filters. This keeps each page O(Limit) without fetching all 14k rows.
func (s *Store) ListAccessAudit(ctx context.Context, f AccessAuditFilter) (ListAccessAuditResult, error) {
	limit := f.Limit
	if limit <= 0 || limit > 5000 {
		limit = 500
	}

	qin := &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		IndexName:              aws.String(s.gsi1Name),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": &ddbtypes.AttributeValueMemberS{Value: auditAccessGSI1PK},
		},
		ScanIndexForward: aws.Bool(false), // newest first
		Limit:            aws.Int32(int32(limit)),
	}

	// Add GSI1SK range filter when date bounds are supplied.
	if !f.From.IsZero() || !f.To.IsZero() {
		if !f.From.IsZero() && !f.To.IsZero() {
			qin.KeyConditionExpression = aws.String("GSI1PK = :pk AND GSI1SK BETWEEN :from AND :to")
			qin.ExpressionAttributeValues[":from"] = &ddbtypes.AttributeValueMemberS{
				Value: f.From.UTC().Format(time.RFC3339Nano),
			}
			qin.ExpressionAttributeValues[":to"] = &ddbtypes.AttributeValueMemberS{
				Value: f.To.UTC().Format(time.RFC3339Nano) + "\xff",
			}
		} else if !f.From.IsZero() {
			qin.KeyConditionExpression = aws.String("GSI1PK = :pk AND GSI1SK >= :from")
			qin.ExpressionAttributeValues[":from"] = &ddbtypes.AttributeValueMemberS{
				Value: f.From.UTC().Format(time.RFC3339Nano),
			}
		} else {
			qin.KeyConditionExpression = aws.String("GSI1PK = :pk AND GSI1SK <= :to")
			qin.ExpressionAttributeValues[":to"] = &ddbtypes.AttributeValueMemberS{
				Value: f.To.UTC().Format(time.RFC3339Nano) + "\xff",
			}
		}
	}

	// Decode cursor if provided.
	if f.Cursor != "" {
		esk, err := decodeCursor(f.Cursor)
		if err == nil && len(esk) > 0 {
			qin.ExclusiveStartKey = esk
		}
	}

	qctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.Query(qctx, qin)
	if err != nil {
		return ListAccessAuditResult{}, fmt.Errorf("phi: list access audit: %w", err)
	}

	scanned := len(out.Items)
	needle := strings.ToLower(strings.TrimSpace(f.SearchText))
	rows := make([]AccessAuditRecord, 0, scanned)
	for _, it := range out.Items {
		var r AccessAuditRecord
		if err := attributevalue.UnmarshalMap(it, &r); err != nil {
			return ListAccessAuditResult{}, fmt.Errorf("phi: unmarshal access audit: %w", err)
		}
		if f.AdminEmail != "" && !strings.EqualFold(r.AdminEmail, f.AdminEmail) {
			continue
		}
		if f.Action != "" && r.Action != f.Action {
			continue
		}
		if f.ResourceType != "" && r.ResourceType != f.ResourceType {
			continue
		}
		if needle != "" {
			hay := strings.ToLower(r.AdminEmail + " " + r.Action + " " + r.ResourceType + " " + r.ResourceID)
			if !strings.Contains(hay, needle) {
				continue
			}
		}
		rows = append(rows, r)
	}

	nextCursor := ""
	if len(out.LastEvaluatedKey) > 0 {
		nextCursor, _ = encodeCursor(out.LastEvaluatedKey)
	}
	return ListAccessAuditResult{Rows: rows, Scanned: scanned, NextCursor: nextCursor}, nil
}

// PHIAuditFilter narrows ListPHIAudit results.
type PHIAuditFilter struct {
	From       time.Time
	To         time.Time
	TableName  string // exact match
	Operation  string // INSERT | UPDATE | DELETE
	SearchText string // substring across table_name/row_id/actor
	Limit      int
	Cursor     string
}

// ListPHIAuditResult is returned by ListPHIAudit.
type ListPHIAuditResult struct {
	Rows       []PHIAuditRecord
	Scanned    int
	NextCursor string
}

// ListPHIAudit queries the GSI1 for all PHI trigger audit rows newest-first.
func (s *Store) ListPHIAudit(ctx context.Context, f PHIAuditFilter) (ListPHIAuditResult, error) {
	limit := f.Limit
	if limit <= 0 || limit > 5000 {
		limit = 500
	}

	qin := &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		IndexName:              aws.String(s.gsi1Name),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": &ddbtypes.AttributeValueMemberS{Value: auditPHIGSI1PK},
		},
		ScanIndexForward: aws.Bool(false),
		Limit:            aws.Int32(int32(limit)),
	}

	if !f.From.IsZero() || !f.To.IsZero() {
		if !f.From.IsZero() && !f.To.IsZero() {
			qin.KeyConditionExpression = aws.String("GSI1PK = :pk AND GSI1SK BETWEEN :from AND :to")
			qin.ExpressionAttributeValues[":from"] = &ddbtypes.AttributeValueMemberS{
				Value: f.From.UTC().Format(time.RFC3339Nano),
			}
			qin.ExpressionAttributeValues[":to"] = &ddbtypes.AttributeValueMemberS{
				Value: f.To.UTC().Format(time.RFC3339Nano) + "\xff",
			}
		} else if !f.From.IsZero() {
			qin.KeyConditionExpression = aws.String("GSI1PK = :pk AND GSI1SK >= :from")
			qin.ExpressionAttributeValues[":from"] = &ddbtypes.AttributeValueMemberS{
				Value: f.From.UTC().Format(time.RFC3339Nano),
			}
		} else {
			qin.KeyConditionExpression = aws.String("GSI1PK = :pk AND GSI1SK <= :to")
			qin.ExpressionAttributeValues[":to"] = &ddbtypes.AttributeValueMemberS{
				Value: f.To.UTC().Format(time.RFC3339Nano) + "\xff",
			}
		}
	}

	if f.Cursor != "" {
		esk, err := decodeCursor(f.Cursor)
		if err == nil && len(esk) > 0 {
			qin.ExclusiveStartKey = esk
		}
	}

	qctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.Query(qctx, qin)
	if err != nil {
		return ListPHIAuditResult{}, fmt.Errorf("phi: list phi audit: %w", err)
	}

	scanned := len(out.Items)
	needle := strings.ToLower(strings.TrimSpace(f.SearchText))
	rows := make([]PHIAuditRecord, 0, scanned)
	for _, it := range out.Items {
		var r PHIAuditRecord
		if err := attributevalue.UnmarshalMap(it, &r); err != nil {
			return ListPHIAuditResult{}, fmt.Errorf("phi: unmarshal phi audit: %w", err)
		}
		if f.TableName != "" && r.TableName != f.TableName {
			continue
		}
		if f.Operation != "" && r.Operation != f.Operation {
			continue
		}
		if needle != "" {
			hay := strings.ToLower(r.TableName + " " + r.RowID + " " + r.Actor)
			if !strings.Contains(hay, needle) {
				continue
			}
		}
		rows = append(rows, r)
	}

	nextCursor := ""
	if len(out.LastEvaluatedKey) > 0 {
		nextCursor, _ = encodeCursor(out.LastEvaluatedKey)
	}
	return ListPHIAuditResult{Rows: rows, Scanned: scanned, NextCursor: nextCursor}, nil
}

// --- cursor helpers ---

// encodeCursor serialises a DDB LastEvaluatedKey into a base64-free JSON
// string safe for URL query params. We JSON-encode the key map's string
// values (all keys in this table are S type).
func encodeCursor(key map[string]ddbtypes.AttributeValue) (string, error) {
	simple := make(map[string]string, len(key))
	for k, v := range key {
		if sv, ok := v.(*ddbtypes.AttributeValueMemberS); ok {
			simple[k] = sv.Value
		}
	}
	b, err := json.Marshal(simple)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func decodeCursor(s string) (map[string]ddbtypes.AttributeValue, error) {
	var simple map[string]string
	if err := json.Unmarshal([]byte(s), &simple); err != nil {
		return nil, err
	}
	out := make(map[string]ddbtypes.AttributeValue, len(simple))
	for k, v := range simple {
		out[k] = &ddbtypes.AttributeValueMemberS{Value: v}
	}
	return out, nil
}
