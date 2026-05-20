// admin_queue.go — DynamoDB access helpers for bt-admin-queue and bt-safety-queue.
//
// Both tables use an identical key shape:
//   PK  = queued_id  (UUID, partition key)
//   SK  = created_at (RFC3339, sort key)
//   GSI = byStatus   (PK=status, SK=created_at) — admin dashboard filter
//
// They are separate physical tables so IAM and admin UI can apply different
// access policies to routine handoffs vs. urgent safety escalations.
// Both are CMK-encrypted (phiKey), PITR on, TTL on `ttl`, RETAIN on destroy.
// They are defined in infra/lib/data-stack.ts alongside the other bt-* tables.
package phi

import (
	"context"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// AdminQueueRecord is one item written to bt-admin-queue or bt-safety-queue.
// extra is serialised as a JSON string to stay schema-free while still keeping
// the attribute scannable by the admin dashboard.
type AdminQueueRecord struct {
	QueuedID         string    `dynamodbav:"queued_id"`
	HandoffType      string    `dynamodbav:"type"`
	Reason           string    `dynamodbav:"reason"`
	RequestID        string    `dynamodbav:"request_id"`
	SessionID        string    `dynamodbav:"session_id"`
	CallerPhone      string    `dynamodbav:"caller_phone,omitempty"`
	CallerEmail      string    `dynamodbav:"caller_email,omitempty"`
	Severity         string    `dynamodbav:"severity"`
	Status           string    `dynamodbav:"status"` // "pending" always on write
	ExtraJSON        string    `dynamodbav:"extra_json,omitempty"`
	CreatedAt        string    `dynamodbav:"created_at"` // RFC3339 — GSI SK
	TTL              int64     `dynamodbav:"ttl"`        // Unix epoch; 90-day auto-purge
	// Safety-queue only fields — omitted for admin-queue items.
	SafetySignalKind string `dynamodbav:"safety_signal_kind,omitempty"`
	NRSReportable    bool   `dynamodbav:"nrs_reportable,omitempty"`
}

// AdminQueueStore writes rows to an admin or safety queue table.
// Both queues share the same key design so one store type handles both;
// callers inject the correct tableName at construction.
type AdminQueueStore struct {
	ddb       DDBClient
	tableName string
	timeout   time.Duration
}

// AdminQueueStoreConfig controls construction.
type AdminQueueStoreConfig struct {
	DDB       DDBClient
	TableName string
	Timeout   time.Duration
}

// NewAdminQueueStore returns a store pointed at the given table.
func NewAdminQueueStore(cfg AdminQueueStoreConfig) (*AdminQueueStore, error) {
	if cfg.DDB == nil || cfg.TableName == "" {
		return nil, fmt.Errorf("phi: AdminQueueStore requires DDB + TableName")
	}
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 3 * time.Second
	}
	return &AdminQueueStore{ddb: cfg.DDB, tableName: cfg.TableName, timeout: timeout}, nil
}

// Put writes one queue record.  The status GSI lets the admin dashboard query
// by status="pending" sorted by created_at.
func (s *AdminQueueStore) Put(ctx context.Context, r AdminQueueRecord) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	item, err := attributevalue.MarshalMap(r)
	if err != nil {
		return fmt.Errorf("phi: marshal admin queue record: %w", err)
	}
	// GSI: byStatus — PK=status, SK=created_at so the admin dashboard can
	// query status="pending" ordered by created_at without a table scan.
	item["GSI_status_PK"] = &ddbtypes.AttributeValueMemberS{Value: r.Status}
	item["GSI_status_SK"] = &ddbtypes.AttributeValueMemberS{Value: r.CreatedAt}

	_, err = s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      item,
	})
	if err != nil {
		return fmt.Errorf("phi: put admin queue record: %w", err)
	}
	return nil
}

// TTLFrom returns a Unix epoch 90 days in the future. Routine handoff rows
// auto-purge after 90 days so the table doesn't grow unbounded.
// Exported so handlers can call it without duplicating the constant.
func TTLFrom(t time.Time) int64 {
	return t.Add(90 * 24 * time.Hour).Unix()
}
