// returning_lookup.go — DynamoDB returning-patient lookup for the clinical-intake gate.
//
// Queries bt-pending-requests via the byPhoneHash or byEmailHash GSI to find the
// most recent prior intake request for a given caller.  Only non-PHI identifiers
// (hashes, session_id, created_at) are ever returned to the caller; raw PHI
// fields are never surfaced.
//
// Design: bt-pending-requests is a separate table from bt-main.  Phone/email
// hashes live in GSI keys only — no raw identifiers in index projections.
package phi

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

// PendingRequestRecord is the shape stored in bt-pending-requests.
// Only the fields the gateway needs for the returning-patient gate are modelled;
// the AI pod may write additional attributes that we ignore.
type PendingRequestRecord struct {
	RequestID  string    `dynamodbav:"request_id"`
	SessionID  string    `dynamodbav:"session_id"`
	PhoneHash  string    `dynamodbav:"phone_hash"`
	EmailHash  string    `dynamodbav:"email_hash"`
	DOB        string    `dynamodbav:"dob_yyyymmdd,omitempty"` // YYYYMMDD, may be absent
	CreatedAt  string    `dynamodbav:"created_at"`             // RFC3339 string (GSI SK)
}

// ReturningLookupResult is what the handler returns to the AI gate.
// No PHI fields — only boolean flags, the hashed DOB flag, and session_id.
type ReturningLookupResult struct {
	Found         bool
	MatchStrength string // "phone" | "email" | "phone_and_dob" | "email_and_dob"
	SessionID     string
	DOBMatch      bool
}

// PendingRequestsStore is a small accessor for the bt-pending-requests table.
// It shares the same DDBClient interface as phi.Store so the same *dynamodb.Client
// can be injected in main.go.
type PendingRequestsStore struct {
	ddb       DDBClient
	tableName string
	timeout   time.Duration
}

// PendingRequestsConfig controls PendingRequestsStore construction.
type PendingRequestsConfig struct {
	DDB       DDBClient
	TableName string
	Timeout   time.Duration
}

var ErrPendingRequestsTableRequired = errors.New("phi: PendingRequestsStore requires DDB + TableName")

// NewPendingRequestsStore builds a PendingRequestsStore.
func NewPendingRequestsStore(cfg PendingRequestsConfig) (*PendingRequestsStore, error) {
	if cfg.DDB == nil || cfg.TableName == "" {
		return nil, ErrPendingRequestsTableRequired
	}
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 3 * time.Second
	}
	return &PendingRequestsStore{ddb: cfg.DDB, tableName: cfg.TableName, timeout: timeout}, nil
}

// LookupByPhoneHash queries the byPhoneHash GSI and returns the most recent record.
// Returns ErrNotFound when no record exists.
func (s *PendingRequestsStore) LookupByPhoneHash(ctx context.Context, phoneHash string) (*PendingRequestRecord, error) {
	return s.lookupByHash(ctx, "byPhoneHash", "phone_hash", phoneHash)
}

// LookupByEmailHash queries the byEmailHash GSI and returns the most recent record.
// Returns ErrNotFound when no record exists.
func (s *PendingRequestsStore) LookupByEmailHash(ctx context.Context, emailHash string) (*PendingRequestRecord, error) {
	return s.lookupByHash(ctx, "byEmailHash", "email_hash", emailHash)
}

func (s *PendingRequestsStore) lookupByHash(ctx context.Context, indexName, attrName, hashValue string) (*PendingRequestRecord, error) {
	if hashValue == "" {
		return nil, ErrNotFound
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		IndexName:              aws.String(indexName),
		KeyConditionExpression: aws.String("#h = :hv"),
		ExpressionAttributeNames: map[string]string{
			"#h": attrName,
		},
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":hv": &ddbtypes.AttributeValueMemberS{Value: hashValue},
		},
		ScanIndexForward: aws.Bool(false), // most recent first
		Limit:            aws.Int32(1),
	})
	if err != nil {
		return nil, fmt.Errorf("phi: pending lookup by %s: %w", attrName, err)
	}
	if len(out.Items) == 0 {
		return nil, ErrNotFound
	}

	var rec PendingRequestRecord
	if err := attributevalue.UnmarshalMap(out.Items[0], &rec); err != nil {
		return nil, fmt.Errorf("phi: unmarshal pending record: %w", err)
	}
	return &rec, nil
}
