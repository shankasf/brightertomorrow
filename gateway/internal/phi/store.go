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
	// AppointmentTime and TherapistStaffID are only set for booking-flow
	// intakes that were confirmed via the calendar agent. Pointer semantics
	// so the attributevalue marshaller emits omitempty — non-booking records
	// do not write these attributes at all.
	AppointmentTime    *time.Time `dynamodbav:"appointmentTime,omitempty"`
	TherapistStaffID   *int       `dynamodbav:"therapistStaffId,omitempty"`
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
	UpdateItem(ctx context.Context, in *dynamodb.UpdateItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.UpdateItemOutput, error)
	BatchGetItem(ctx context.Context, in *dynamodb.BatchGetItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.BatchGetItemOutput, error)
	DeleteItem(ctx context.Context, in *dynamodb.DeleteItemInput, opts ...func(*dynamodb.Options)) (*dynamodb.DeleteItemOutput, error)
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

// IntakeKey identifies one PHI record for batch fetch.
type IntakeKey struct {
	EmailHash      string
	SubmissionUUID string
}

// BatchGetIntakes fetches up to len(keys) PHI records in parallel using
// DynamoDB BatchGetItem (capped at 100 items per call by AWS). Returns a
// map keyed by submission_uuid so callers can re-assemble in their own
// order; missing keys are simply absent from the map (no error).
//
// Why this exists: list views (appointments, insurance-checks) previously
// looped GetItem per row, causing 25 serial round-trips per page and ~5,000
// for a full CSV export. BatchGetItem collapses that to ⌈N/100⌉ calls.
//
// UnprocessedKeys (returned by DDB under throttle) are retried with
// exponential backoff, same shape as DeleteChatSession. ConsistentRead is
// preserved per AWS GetItem semantics (BatchGetItem accepts ConsistentRead
// per table).
func (s *Store) BatchGetIntakes(ctx context.Context, keys []IntakeKey) (map[string]*IntakeRecord, error) {
	out := make(map[string]*IntakeRecord, len(keys))
	if len(keys) == 0 {
		return out, nil
	}

	// Drop dup keys — BatchGetItem rejects duplicates inside a single call.
	seen := make(map[string]struct{}, len(keys))
	deduped := make([]IntakeKey, 0, len(keys))
	for _, k := range keys {
		if k.EmailHash == "" || k.SubmissionUUID == "" {
			continue
		}
		id := k.EmailHash + "|" + k.SubmissionUUID
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		deduped = append(deduped, k)
	}

	for start := 0; start < len(deduped); start += 100 {
		end := start + 100
		if end > len(deduped) {
			end = len(deduped)
		}
		chunk := deduped[start:end]

		reqKeys := make([]map[string]ddbtypes.AttributeValue, 0, len(chunk))
		for _, k := range chunk {
			reqKeys = append(reqKeys, map[string]ddbtypes.AttributeValue{
				"PK": &ddbtypes.AttributeValueMemberS{Value: patientPK(k.EmailHash)},
				"SK": &ddbtypes.AttributeValueMemberS{Value: intakeSK(k.SubmissionUUID)},
			})
		}

		pending := map[string]ddbtypes.KeysAndAttributes{
			s.tableName: {
				Keys:           reqKeys,
				ConsistentRead: aws.Bool(true),
			},
		}

		// Retry UnprocessedKeys with exponential backoff. Bounded so a sticky
		// throttle can't pin the handler — caller's request context still wins.
		for attempt := 0; attempt < 6 && len(pending[s.tableName].Keys) > 0; attempt++ {
			bctx, bcancel := context.WithTimeout(ctx, s.timeout)
			resp, err := s.ddb.BatchGetItem(bctx, &dynamodb.BatchGetItemInput{
				RequestItems: pending,
			})
			bcancel()
			if err != nil {
				return out, fmt.Errorf("phi: batch get intakes: %w", err)
			}
			for _, items := range resp.Responses {
				for _, it := range items {
					var rec IntakeRecord
					if err := attributevalue.UnmarshalMap(it, &rec); err != nil {
						return out, fmt.Errorf("phi: unmarshal intake (batch): %w", err)
					}
					out[rec.SubmissionUUID] = &rec
				}
			}
			if u, ok := resp.UnprocessedKeys[s.tableName]; ok && len(u.Keys) > 0 {
				pending = map[string]ddbtypes.KeysAndAttributes{s.tableName: u}
				sleep := time.Duration(50<<attempt) * time.Millisecond
				select {
				case <-ctx.Done():
					return out, ctx.Err()
				case <-time.After(sleep):
				}
				continue
			}
			pending = nil
			break
		}
		if pending != nil && len(pending[s.tableName].Keys) > 0 {
			return out, fmt.Errorf("phi: batch get intakes: %d keys unprocessed after retries",
				len(pending[s.tableName].Keys))
		}
	}
	return out, nil
}

// DeleteIntake hard-deletes one PHI record. Used by the data-quality
// cleanup tool (cleanup_incomplete_intakes) to remove submissions whose
// required identity fields were never populated. Caller is responsible
// for also purging the matching pointer row from Postgres so the two
// stores stay consistent.
func (s *Store) DeleteIntake(ctx context.Context, emailHash, submissionUUID string) error {
	if emailHash == "" || submissionUUID == "" {
		return errors.New("phi: emailHash and submissionUUID required")
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	_, err := s.ddb.DeleteItem(ctx, &dynamodb.DeleteItemInput{
		TableName: aws.String(s.tableName),
		Key: map[string]ddbtypes.AttributeValue{
			"PK": &ddbtypes.AttributeValueMemberS{Value: patientPK(emailHash)},
			"SK": &ddbtypes.AttributeValueMemberS{Value: intakeSK(submissionUUID)},
		},
	})
	if err != nil {
		return fmt.Errorf("phi: delete intake: %w", err)
	}
	return nil
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
//
// DynamoDB can return UnprocessedItems on throttling — we retry those
// in-place with exponential backoff and only credit the returned count
// once DDB confirms the deletes. Without this, the returned `deleted`
// count was wildly inflated (every attempted write was counted, even
// retries) and throttled deletes could silently leave PHI behind for the
// duration of a single sweep.
func (s *Store) DeleteChatSession(ctx context.Context, sessionID string) (int, error) {
	if sessionID == "" {
		return 0, errors.New("phi: SessionID is required")
	}
	deleted := 0
	// Outer cap: at 25 deletes per batch, this would handle ~2500 turns —
	// far more than any realistic chat session — without an unbounded loop.
	const maxBatches = 100
	for batchN := 0; batchN < maxBatches; batchN++ {
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

		// Retry UnprocessedItems with exponential backoff. Cap retries so a
		// pathological throttle doesn't hold the goroutine forever.
		pending := writes
		for retry := 0; retry < 6 && len(pending) > 0; retry++ {
			bctx, bcancel := context.WithTimeout(ctx, s.timeout)
			resp, err := s.ddb.BatchWriteItem(bctx, &dynamodb.BatchWriteItemInput{
				RequestItems: map[string][]ddbtypes.WriteRequest{s.tableName: pending},
			})
			bcancel()
			if err != nil {
				return deleted, fmt.Errorf("phi: delete chat: batch: %w", err)
			}
			confirmed := len(pending)
			pending = nil
			if resp != nil {
				if u, ok := resp.UnprocessedItems[s.tableName]; ok && len(u) > 0 {
					confirmed -= len(u)
					pending = u
				}
			}
			deleted += confirmed
			if len(pending) == 0 {
				break
			}
			// Backoff: 50ms, 100ms, 200ms, 400ms, 800ms, 1600ms — bounded
			// to keep total worst case well under one minute per page.
			sleep := time.Duration(50<<retry) * time.Millisecond
			select {
			case <-ctx.Done():
				return deleted, ctx.Err()
			case <-time.After(sleep):
			}
		}
		if len(pending) > 0 {
			return deleted, fmt.Errorf("phi: delete chat: %d items unprocessed after retries", len(pending))
		}
	}
	return deleted, fmt.Errorf("phi: delete chat: exceeded %d batch iterations", maxBatches)
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
