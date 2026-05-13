// callbacks.go — DynamoDB persistence for "please phone me back" requests.
//
// Why this lives in DDB and not Postgres
// ======================================
// callback_requests rows hold raw first_name + last_name + phone. Under
// HIPAA Safe Harbor those are direct identifiers (§164.514(b)(2)(i, ii, iv)).
// Hostinger does not sign a BAA, so the VPS Postgres cannot legally hold
// these. The bt-main DynamoDB table is CMK-encrypted, BAA-covered, and
// already stores every other piece of patient PHI; callback requests now
// land here too.
//
// Single-table key shape
// ======================
//   PK     = "PATIENT#callback-<uuid>"   (mirrors the contact-submission
//                                         PK shape — one synthetic patient
//                                         per callback since most callers
//                                         only give us a phone, no email)
//   SK     = "CALLBACK#meta"             (single-row entity for now)
//   GSI1PK = "ENTITY#CALLBACK"           (admin list query — all callbacks)
//   GSI1SK = "<RFC3339Nano createdAt>#<uuid>"  (sortable, unique)
//
// Admin list pagination is cursor-style under the hood (DDB has no OFFSET)
// — ListCallbacks returns up to `limit` items most-recent-first. The
// existing admin page asks for page=1..N with a stable page size; we
// translate that to a single overfetched Query and slice in memory. For
// the current scale (~10s–100s of rows/year) this is correct + cheap.
// When the table grows beyond ~10k callbacks, swap the admin UI to a
// nextCursor model and drop the in-memory slice.
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

// CallbackRecord is the PHI-of-record for one "call me back" request.
type CallbackRecord struct {
	CallbackID  string    `dynamodbav:"callbackId"`  // UUID; also embedded in PK
	FirstName   string    `dynamodbav:"firstName"`
	LastName    string    `dynamodbav:"lastName"`
	Phone       string    `dynamodbav:"phone"`
	Reason      string    `dynamodbav:"reason"`
	Source      string    `dynamodbav:"source"` // chat-agent | voice-agent | voice-phone
	CreatedAt   time.Time `dynamodbav:"createdAt"`
	RetainUntil time.Time `dynamodbav:"retainUntil"`
	PurgedAt    *time.Time `dynamodbav:"purgedAt,omitempty"`
}

const (
	callbackGSI1PKValue = "ENTITY#CALLBACK"
	callbackSK          = "CALLBACK#meta"
)

func callbackPK(id string) string { return "PATIENT#callback-" + id }

// PutCallback writes one callback PHI row. Caller sets CallbackID,
// CreatedAt, RetainUntil before calling. The condition expression makes
// duplicate UUIDs surface as ErrAlreadyExists rather than overwriting.
func (s *Store) PutCallback(ctx context.Context, r CallbackRecord) error {
	if strings.TrimSpace(r.CallbackID) == "" {
		return errors.New("phi: CallbackID is required")
	}
	if strings.TrimSpace(r.FirstName) == "" || strings.TrimSpace(r.LastName) == "" {
		return errors.New("phi: callback first_name + last_name are required")
	}
	if strings.TrimSpace(r.Phone) == "" {
		return errors.New("phi: callback phone is required")
	}
	if strings.TrimSpace(r.Reason) == "" {
		return errors.New("phi: callback reason is required")
	}
	if strings.TrimSpace(r.Source) == "" {
		return errors.New("phi: callback source is required")
	}
	if r.CreatedAt.IsZero() {
		return errors.New("phi: callback CreatedAt is required")
	}
	if r.RetainUntil.IsZero() {
		return errors.New("phi: callback RetainUntil is required")
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	item, err := attributevalue.MarshalMap(r)
	if err != nil {
		return fmt.Errorf("phi: marshal callback: %w", err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: callbackPK(r.CallbackID)}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: callbackSK}
	item["GSI1PK"] = &ddbtypes.AttributeValueMemberS{Value: callbackGSI1PKValue}
	item["GSI1SK"] = &ddbtypes.AttributeValueMemberS{
		Value: r.CreatedAt.UTC().Format(time.RFC3339Nano) + "#" + r.CallbackID,
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
		return fmt.Errorf("phi: put callback: %w", err)
	}
	return nil
}

// CallbackFilter narrows ListCallbacks. Empty fields mean "no filter".
type CallbackFilter struct {
	Source     string // exact source match: chat-agent | voice-agent | voice-phone
	SearchText string // case-insensitive substring across first/last/phone/reason
	Limit      int    // hard cap on rows scanned from DDB before in-memory filter
}

// ListCallbacks returns callbacks most-recent-first, optionally filtered.
// Filters run in-memory after the DDB Query because the result set is
// small (tens to thousands of rows). Caller paginates the returned slice.
//
// Returns (rows, scanned) — `scanned` is the DDB item count BEFORE filter,
// which lets the admin UI show "filtered N of M" if it wants.
func (s *Store) ListCallbacks(ctx context.Context, f CallbackFilter) ([]CallbackRecord, int, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	limit := f.Limit
	if limit <= 0 || limit > 10000 {
		limit = 10000
	}

	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		IndexName:              aws.String(s.gsi1Name),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk": &ddbtypes.AttributeValueMemberS{Value: callbackGSI1PKValue},
		},
		ScanIndexForward: aws.Bool(false), // DESC by GSI1SK = most recent first
		Limit:            aws.Int32(int32(limit)),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("phi: list callbacks: %w", err)
	}

	scanned := len(out.Items)
	rows := make([]CallbackRecord, 0, scanned)
	needle := strings.ToLower(strings.TrimSpace(f.SearchText))
	for _, it := range out.Items {
		var r CallbackRecord
		if err := attributevalue.UnmarshalMap(it, &r); err != nil {
			return nil, scanned, fmt.Errorf("phi: unmarshal callback: %w", err)
		}
		if r.PurgedAt != nil {
			continue
		}
		if f.Source != "" && r.Source != f.Source {
			continue
		}
		if needle != "" {
			hay := strings.ToLower(r.FirstName + " " + r.LastName + " " + r.Phone + " " + r.Reason)
			if !strings.Contains(hay, needle) {
				continue
			}
		}
		rows = append(rows, r)
	}
	return rows, scanned, nil
}
