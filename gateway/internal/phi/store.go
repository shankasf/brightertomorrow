// Package phi is the gateway's interface to PHI-of-record storage in
// DynamoDB bt-main (CMK-encrypted). Postgres holds only non-PHI pointer
// rows; everything identifying about a patient lives here.
//
// Single-table design:
//
//	PK = "PATIENT#<sha256(lower(email))>"
//	SK = "INTAKE#<submission_uuid>"
//	GSI1PK = "STATUS#<status>"
//	GSI1SK = "<RFC3339 createdAt>#<submission_uuid>"
//
// Failure mode contract: every method returns an error on transport,
// throttling, or auth failure. Callers MUST treat that as fail-closed —
// a failed PutIntake means "we did not accept this PHI", and the HTTP
// handler must return 5xx so the client retries instead of believing
// their data was saved.
package phi

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/feature/dynamodb/attributevalue"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
)

const (
	// Status values mirror the gateway's intake handler. Keep in sync.
	StatusEligible          = "eligible"
	StatusSelfPay           = "self_pay"
	StatusNeedsReview       = "needs_review"
	StatusVerificationError = "verification_error"

	defaultGSI1 = "GSI1"
)

// IntakeRecord is the PHI-of-record for one intake submission.
// All fields are written to DynamoDB; nothing identifying is held back.
type IntakeRecord struct {
	SubmissionUUID         string            `dynamodbav:"submissionUuid"`
	EmailHash              string            `dynamodbav:"emailHash"`
	Flow                   string            `dynamodbav:"flow"`
	Service                string            `dynamodbav:"service"`
	PaymentMethod          string            `dynamodbav:"paymentMethod"`
	Source                 string            `dynamodbav:"source"`
	FirstName              string            `dynamodbav:"firstName"`
	LastName               string            `dynamodbav:"lastName"`
	DateOfBirth            string            `dynamodbav:"dateOfBirth"` // ISO YYYY-MM-DD
	Phone                  string            `dynamodbav:"phone"`
	Email                  string            `dynamodbav:"email"`
	HomeAddress            string            `dynamodbav:"homeAddress"`
	Sex                    string            `dynamodbav:"sex"`
	InsuranceName          string            `dynamodbav:"insuranceName,omitempty"`
	InsuranceMemberID      string            `dynamodbav:"insuranceMemberId,omitempty"`
	SubscriberName         string            `dynamodbav:"subscriberName,omitempty"`
	SubscriberRelationship string            `dynamodbav:"subscriberRelationship,omitempty"`
	Notes                  string            `dynamodbav:"notes,omitempty"`
	CoverageStatus         string            `dynamodbav:"coverageStatus"`
	Eligible               bool              `dynamodbav:"eligible"`
	Coverage               map[string]string `dynamodbav:"coverage,omitempty"`
	CreatedAt              time.Time         `dynamodbav:"createdAt"`
	RetainUntil            time.Time         `dynamodbav:"retainUntil"`
}

// Pointer is a non-PHI summary suitable for admin list views.
type Pointer struct {
	SubmissionUUID string
	EmailHash      string
	Status         string
	CreatedAt      time.Time
}

// DDBClient is the subset of the SDK we use; lets tests inject a fake.
type DDBClient interface {
	PutItem(ctx context.Context, in *dynamodb.PutItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.PutItemOutput, error)
	GetItem(ctx context.Context, in *dynamodb.GetItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.GetItemOutput, error)
	Query(ctx context.Context, in *dynamodb.QueryInput, opts ...func(*dynamodb.Options)) (*dynamodb.QueryOutput, error)
	BatchWriteItem(ctx context.Context, in *dynamodb.BatchWriteItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.BatchWriteItemOutput, error)
	DescribeTable(ctx context.Context, in *dynamodb.DescribeTableInput, opts ...func(*dynamodb.Options)) (*dynamodb.DescribeTableOutput, error)
}

// ChatTurn is one user/assistant message in a chat (or voice) session.
// PK = CHAT#<session_id>, SK = TURN#<RFC3339Nano>#<role-short>
// so we can Query a session in chronological order without an extra index.
type ChatTurn struct {
	SessionID   string    `dynamodbav:"sessionId"`
	Role        string    `dynamodbav:"role"`        // 'user' | 'assistant' | 'system' | 'tool'
	Content     string    `dynamodbav:"content"`     // plaintext message body
	CreatedAt   time.Time `dynamodbav:"createdAt"`
	RetainUntil time.Time `dynamodbav:"retainUntil"` // 10y from CreatedAt
}

// Store is the gateway-facing API. Construct with New.
type Store struct {
	ddb       DDBClient
	tableName string
	gsi1Name  string
	timeout   time.Duration
}

// Config controls Store construction. TableName + DDB are required;
// GSI1Name and Timeout have sane defaults.
type Config struct {
	DDB       DDBClient
	TableName string
	GSI1Name  string
	Timeout   time.Duration
}

func New(cfg Config) (*Store, error) {
	if cfg.DDB == nil {
		return nil, errors.New("phi: DDB client is required")
	}
	if cfg.TableName == "" {
		return nil, errors.New("phi: TableName is required")
	}
	gsi := cfg.GSI1Name
	if gsi == "" {
		gsi = defaultGSI1
	}
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 3 * time.Second
	}
	return &Store{
		ddb:       cfg.DDB,
		tableName: cfg.TableName,
		gsi1Name:  gsi,
		timeout:   timeout,
	}, nil
}

// HashEmail returns the deterministic email_hash used for PK derivation
// and Postgres pointer rows. Lowercases + trims whitespace before hashing.
func HashEmail(email string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(email))))
	return hex.EncodeToString(sum[:])
}

func patientPK(emailHash string) string { return "PATIENT#" + emailHash }
func intakeSK(submissionUUID string) string {
	return "INTAKE#" + submissionUUID
}
func statusGSI1PK(status string) string { return "STATUS#" + status }

// PutIntake writes one PHI record. Caller is responsible for setting
// SubmissionUUID, EmailHash, CreatedAt, RetainUntil, and a valid Status.
// Uses a condition expression so a duplicate submission_uuid surfaces as
// ErrAlreadyExists rather than silently overwriting.
func (s *Store) PutIntake(ctx context.Context, r IntakeRecord) error {
	if err := validate(r); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	item, err := attributevalue.MarshalMap(r)
	if err != nil {
		return fmt.Errorf("phi: marshal intake: %w", err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: patientPK(r.EmailHash)}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: intakeSK(r.SubmissionUUID)}
	item["GSI1PK"] = &ddbtypes.AttributeValueMemberS{Value: statusGSI1PK(r.CoverageStatus)}
	item["GSI1SK"] = &ddbtypes.AttributeValueMemberS{
		Value: r.CreatedAt.UTC().Format(time.RFC3339Nano) + "#" + r.SubmissionUUID,
	}

	_, err = s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName:           aws.String(s.tableName),
		Item:                item,
		ConditionExpression: aws.String("attribute_not_exists(PK) AND attribute_not_exists(SK)"),
	})
	if err != nil {
		var cond *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &cond) {
			return ErrAlreadyExists
		}
		return fmt.Errorf("phi: put intake: %w", err)
	}
	return nil
}

// GetIntake fetches one PHI record. emailHash + submissionUUID together
// form the primary key. Returns ErrNotFound if the row is gone (purged
// or never existed).
func (s *Store) GetIntake(ctx context.Context, emailHash, submissionUUID string) (*IntakeRecord, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.tableName),
		Key: map[string]ddbtypes.AttributeValue{
			"PK": &ddbtypes.AttributeValueMemberS{Value: patientPK(emailHash)},
			"SK": &ddbtypes.AttributeValueMemberS{Value: intakeSK(submissionUUID)},
		},
		ConsistentRead: aws.Bool(true),
	})
	if err != nil {
		return nil, fmt.Errorf("phi: get intake: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, ErrNotFound
	}

	var rec IntakeRecord
	if err := attributevalue.UnmarshalMap(out.Item, &rec); err != nil {
		return nil, fmt.Errorf("phi: unmarshal intake: %w", err)
	}
	return &rec, nil
}

// ListByStatus returns intake pointers in a given status (eg "needs_review")
// ordered by createdAt descending. Capped at limit (1..100) per call.
// Use exclusiveStart from a prior result for pagination.
func (s *Store) ListByStatus(
	ctx context.Context,
	status string,
	limit int32,
	exclusiveStart map[string]ddbtypes.AttributeValue,
) ([]Pointer, map[string]ddbtypes.AttributeValue, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		IndexName:              aws.String(s.gsi1Name),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": &ddbtypes.AttributeValueMemberS{Value: statusGSI1PK(status)},
		},
		ScanIndexForward:  aws.Bool(false), // newest first
		Limit:             aws.Int32(limit),
		ExclusiveStartKey: exclusiveStart,
	})
	if err != nil {
		return nil, nil, fmt.Errorf("phi: list by status: %w", err)
	}

	pointers := make([]Pointer, 0, len(out.Items))
	for _, it := range out.Items {
		var rec IntakeRecord
		if err := attributevalue.UnmarshalMap(it, &rec); err != nil {
			return nil, nil, fmt.Errorf("phi: unmarshal intake (list): %w", err)
		}
		pointers = append(pointers, Pointer{
			SubmissionUUID: rec.SubmissionUUID,
			EmailHash:      rec.EmailHash,
			Status:         rec.CoverageStatus,
			CreatedAt:      rec.CreatedAt,
		})
	}
	return pointers, out.LastEvaluatedKey, nil
}

// Ping is a cheap reachability check for /readyz. Calls DescribeTable
// with a short timeout. Returns nil if the table is reachable and ACTIVE.
func (s *Store) Ping(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()

	out, err := s.ddb.DescribeTable(ctx, &dynamodb.DescribeTableInput{
		TableName: aws.String(s.tableName),
	})
	if err != nil {
		return fmt.Errorf("phi: ping: %w", err)
	}
	if out.Table == nil || out.Table.TableStatus != ddbtypes.TableStatusActive {
		return fmt.Errorf("phi: ping: table not ACTIVE")
	}
	return nil
}

// Errors callers should switch on.
var (
	ErrNotFound      = errors.New("phi: intake record not found")
	ErrAlreadyExists = errors.New("phi: intake submission_uuid already exists")
)

// ---------------------------------------------------------------------------
// Chat turns — full conversation history lives in DynamoDB. Postgres only
// keeps the session id + counters. §164.502(b)
// ---------------------------------------------------------------------------

func chatPK(sessionID string) string { return "CHAT#" + sessionID }

// chatSK returns a sortable composite. Nano-precision timestamp keeps two
// turns submitted in the same millisecond ordered correctly; the role suffix
// disambiguates the rare case where user+assistant share the same ts.
func chatSK(t time.Time, role string) string {
	short := "u"
	if role == "assistant" {
		short = "a"
	} else if role == "system" {
		short = "s"
	} else if role == "tool" {
		short = "t"
	}
	return "TURN#" + t.UTC().Format(time.RFC3339Nano) + "#" + short
}

// PutChatTurn writes a single chat/voice turn. Caller must populate
// SessionID, Role, Content, CreatedAt; RetainUntil defaults to +10y.
func (s *Store) PutChatTurn(ctx context.Context, t ChatTurn) error {
	if t.SessionID == "" {
		return errors.New("phi: chat turn SessionID is required")
	}
	if t.Role == "" {
		return errors.New("phi: chat turn Role is required")
	}
	if t.CreatedAt.IsZero() {
		t.CreatedAt = time.Now().UTC()
	}
	if t.RetainUntil.IsZero() {
		t.RetainUntil = t.CreatedAt.AddDate(10, 0, 0)
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	item, err := attributevalue.MarshalMap(t)
	if err != nil {
		return fmt.Errorf("phi: marshal chat turn: %w", err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: chatPK(t.SessionID)}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: chatSK(t.CreatedAt, t.Role)}

	if _, err = s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      item,
	}); err != nil {
		return fmt.Errorf("phi: put chat turn: %w", err)
	}
	return nil
}

// ListChatTurns returns up to `limit` turns for the session. If `desc` is
// true, returns newest-first (used by AI to pull recent history); otherwise
// oldest-first (used by admin transcript view).
func (s *Store) ListChatTurns(ctx context.Context, sessionID string, limit int32, desc bool) ([]ChatTurn, error) {
	if sessionID == "" {
		return nil, errors.New("phi: SessionID is required")
	}
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": &ddbtypes.AttributeValueMemberS{Value: chatPK(sessionID)},
			":sk": &ddbtypes.AttributeValueMemberS{Value: "TURN#"},
		},
		ScanIndexForward: aws.Bool(!desc),
		Limit:            aws.Int32(limit),
	})
	if err != nil {
		return nil, fmt.Errorf("phi: list chat turns: %w", err)
	}
	turns := make([]ChatTurn, 0, len(out.Items))
	for _, it := range out.Items {
		var t ChatTurn
		if err := attributevalue.UnmarshalMap(it, &t); err != nil {
			return nil, fmt.Errorf("phi: unmarshal chat turn: %w", err)
		}
		turns = append(turns, t)
	}
	return turns, nil
}

// DeleteChatSession removes every turn for a session. Used by the admin
// purge endpoint and the retention sweeper. BatchWriteItem caps at 25 keys
// per call, so we loop until the session has no more turns.
func (s *Store) DeleteChatSession(ctx context.Context, sessionID string) (int, error) {
	if sessionID == "" {
		return 0, errors.New("phi: SessionID is required")
	}
	deleted := 0
	for {
		// Fetch a page of SK values only (smaller payload than full items).
		qctx, qcancel := context.WithTimeout(ctx, s.timeout)
		out, err := s.ddb.Query(qctx, &dynamodb.QueryInput{
			TableName:              aws.String(s.tableName),
			KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
			ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
				":pk": &ddbtypes.AttributeValueMemberS{Value: chatPK(sessionID)},
				":sk": &ddbtypes.AttributeValueMemberS{Value: "TURN#"},
			},
			ProjectionExpression: aws.String("PK, SK"),
			Limit:                aws.Int32(25),
		})
		qcancel()
		if err != nil {
			return deleted, fmt.Errorf("phi: delete chat: query: %w", err)
		}
		if len(out.Items) == 0 {
			return deleted, nil
		}

		writes := make([]ddbtypes.WriteRequest, 0, len(out.Items))
		for _, it := range out.Items {
			writes = append(writes, ddbtypes.WriteRequest{
				DeleteRequest: &ddbtypes.DeleteRequest{
					Key: map[string]ddbtypes.AttributeValue{
						"PK": it["PK"],
						"SK": it["SK"],
					},
				},
			})
		}

		bctx, bcancel := context.WithTimeout(ctx, s.timeout)
		_, err = s.ddb.BatchWriteItem(bctx, &dynamodb.BatchWriteItemInput{
			RequestItems: map[string][]ddbtypes.WriteRequest{s.tableName: writes},
		})
		bcancel()
		if err != nil {
			return deleted, fmt.Errorf("phi: delete chat: batch: %w", err)
		}
		deleted += len(writes)
	}
}

func validate(r IntakeRecord) error {
	switch {
	case r.SubmissionUUID == "":
		return errors.New("phi: SubmissionUUID is required")
	case r.EmailHash == "":
		return errors.New("phi: EmailHash is required")
	case r.CoverageStatus == "":
		return errors.New("phi: CoverageStatus is required")
	case r.CreatedAt.IsZero():
		return errors.New("phi: CreatedAt is required")
	case r.RetainUntil.IsZero():
		return errors.New("phi: RetainUntil is required")
	}
	return nil
}
