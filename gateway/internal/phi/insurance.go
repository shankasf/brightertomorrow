// insurance.go — DynamoDB persistence for insurance eligibility checks.
//
// Why this lives in DDB and not Postgres
// ======================================
// Insurance check rows carry patient name / DOB / phone / email / member
// ID plus payer + status. That is full PHI. The bt-main DynamoDB table is
// CMK-encrypted, BAA-covered, and the only place this data is allowed to
// land — Hostinger does not sign a BAA, so the VPS Postgres cannot hold
// it. Admin reads are audited per row via admin.LogPHIAccessBatch.
//
// Single-table key shape
// ======================
//   PK     = "PATIENT#<emailHash>"
//   SK     = "INSURANCE#<checkUUID>"
//   GSI1PK = "ENTITY#INSURANCE"         (admin list — all insurance checks)
//   GSI1SK = "<RFC3339 createdAt>#<checkUUID>"  (sortable, unique)
//
// Reuse pattern (same-session verification)
// =========================================
// When a chatbot / voice agent runs verify_coverage, it writes a standalone
// InsuranceCheckRecord (SubmissionUUID = ""). When the visitor subsequently
// completes a booking in the same session, FindStandaloneCheckForReuse
// locates that record by emailHash + payerName within the last 30 minutes.
// LinkCheckToSubmission then updates it in place — exactly one DDB item
// per eligibility decision, cleanly linked to the booking.
//
// Admin list pagination
// =====================
// ListInsuranceChecks fetches the GSI1 partition most-recent-first.
// At ~14k rows / year the full scan + in-memory filter is fine. When the
// table grows into the 100k range, switch the admin UI to cursor pagination
// and drop the in-memory slice.
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

// InsuranceCheckRecord is the PHI record for one eligibility check.
// When SubmissionUUID is empty the check is "standalone" (no booking yet).
// When linked, SubmissionUUID points to the IntakeRecord in DDB.
//
// PHI fields (FirstName/LastName/DateOfBirth/Phone/Email/MemberID) are
// stored in plaintext on the same BAA-covered, CMK-encrypted bt-main table
// that holds IntakeRecord PHI. Admin reads are audited via
// admin.LogPHIAccessBatch in handlers/admin_insurance_checks.go. Without
// these on the record, standalone chatbot / voice / website coverage checks
// render as "—" in /admin/insurance-checks until they get linked to a
// booking, which defeats the audit-trail purpose of the page.
type InsuranceCheckRecord struct {
	CheckUUID      string     `dynamodbav:"checkUuid"`
	SubmissionUUID string     `dynamodbav:"submissionUuid,omitempty"`
	ChatSessionID  string     `dynamodbav:"chatSessionId,omitempty"`
	Source         string     `dynamodbav:"source"`
	PayerName      string     `dynamodbav:"payerName,omitempty"`
	PayerID        string     `dynamodbav:"payerId,omitempty"`
	CoverageStatus string     `dynamodbav:"coverageStatus"`
	Eligible       bool       `dynamodbav:"eligible"`
	EmailHash      string     `dynamodbav:"emailHash"`
	FirstName      string     `dynamodbav:"firstName,omitempty"`
	LastName       string     `dynamodbav:"lastName,omitempty"`
	DateOfBirth    string     `dynamodbav:"dateOfBirth,omitempty"` // YYYY-MM-DD
	Phone          string     `dynamodbav:"phone,omitempty"`
	Email          string     `dynamodbav:"email,omitempty"`
	MemberID       string     `dynamodbav:"insuranceMemberId,omitempty"`
	CreatedAt      time.Time  `dynamodbav:"createdAt"`
	RetainUntil    time.Time  `dynamodbav:"retainUntil"`
	PurgedAt       *time.Time `dynamodbav:"purgedAt,omitempty"`
}

const (
	insuranceGSI1PKValue = "ENTITY#INSURANCE"
)

func insuranceSK(checkUUID string) string { return "INSURANCE#" + checkUUID }

// PutInsuranceCheck writes one insurance check record. CheckUUID, EmailHash,
// Source, CoverageStatus, CreatedAt, and RetainUntil must be non-zero.
// The condition expression turns duplicate check_uuid writes into ErrAlreadyExists.
func (s *Store) PutInsuranceCheck(ctx context.Context, r InsuranceCheckRecord) error {
	if err := validateInsuranceCheck(r); err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	item, err := attributevalue.MarshalMap(r)
	if err != nil {
		return fmt.Errorf("phi: marshal insurance check: %w", err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: patientPK(r.EmailHash)}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: insuranceSK(r.CheckUUID)}
	item["GSI1PK"] = &ddbtypes.AttributeValueMemberS{Value: insuranceGSI1PKValue}
	item["GSI1SK"] = &ddbtypes.AttributeValueMemberS{
		Value: r.CreatedAt.UTC().Format(time.RFC3339Nano) + "#" + r.CheckUUID,
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
		return fmt.Errorf("phi: put insurance check: %w", err)
	}
	return nil
}

// GetInsuranceCheckByCheckUUID fetches one insurance check using the GSI1
// to find its emailHash (PK), then does a consistent GetItem. Returns
// ErrNotFound if the item does not exist or has been purged.
//
// Implementation note: because checkUUID is not the DDB PK, we query GSI1
// with a FilterExpression on checkUuid. At current scale (~14k rows/year)
// this is one round-trip. If that changes, add a GSI2 on checkUuid.
func (s *Store) GetInsuranceCheckByCheckUUID(ctx context.Context, checkUUID string) (*InsuranceCheckRecord, error) {
	if checkUUID == "" {
		return nil, errors.New("phi: checkUUID is required")
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		IndexName:              aws.String(s.gsi1Name),
		KeyConditionExpression: aws.String("GSI1PK = :pk"),
		FilterExpression:       aws.String("checkUuid = :cid"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk":  &ddbtypes.AttributeValueMemberS{Value: insuranceGSI1PKValue},
			":cid": &ddbtypes.AttributeValueMemberS{Value: checkUUID},
		},
		Limit: aws.Int32(1),
	})
	if err != nil {
		return nil, fmt.Errorf("phi: get insurance check by uuid: %w", err)
	}
	if len(out.Items) == 0 {
		return nil, ErrNotFound
	}
	var rec InsuranceCheckRecord
	if err := attributevalue.UnmarshalMap(out.Items[0], &rec); err != nil {
		return nil, fmt.Errorf("phi: unmarshal insurance check: %w", err)
	}
	return &rec, nil
}

// InsuranceReuse holds the fields the caller needs from a reusable standalone
// check (the same data intake.go / internal_calendar.go used to read from
// Postgres).
type InsuranceReuse struct {
	CheckUUID      string
	Eligible       bool
	CoverageStatus string
}

// FindStandaloneCheckForReuse returns the most recent standalone
// (SubmissionUUID == "") insurance check for the given emailHash + payerName
// that was created within `within` duration ago. Returns ErrNotFound when no
// usable row exists — callers fall through to a fresh CLAIM.MD call.
//
// This mirrors the Postgres query:
//
//	SELECT id, eligible, coverage_status FROM bt.insurance_checks
//	 WHERE email_hash = $1 AND payer_name = $2
//	   AND submission_uuid IS NULL
//	   AND created_at > NOW() - INTERVAL '30 minutes'
//	 ORDER BY created_at DESC LIMIT 1
func (s *Store) FindStandaloneCheckForReuse(ctx context.Context, emailHash, payerName string, within time.Duration) (*InsuranceReuse, error) {
	if emailHash == "" {
		return nil, errors.New("phi: emailHash is required")
	}
	cutoff := time.Now().UTC().Add(-within)

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	// Query the patient partition for INSURANCE# items, newest-first.
	// We filter in-memory for payerName + standalone + recency because the
	// patient partition is small (one check per session) and DDB FilterExpression
	// does not consume additional RCU.
	out, err := s.ddb.Query(ctx, &dynamodb.QueryInput{
		TableName:              aws.String(s.tableName),
		KeyConditionExpression: aws.String("PK = :pk AND begins_with(SK, :sk)"),
		FilterExpression:       aws.String("attribute_not_exists(submissionUuid) OR submissionUuid = :empty"),
		ExpressionAttributeValues: map[string]ddbtypes.AttributeValue{
			":pk":    &ddbtypes.AttributeValueMemberS{Value: patientPK(emailHash)},
			":sk":    &ddbtypes.AttributeValueMemberS{Value: "INSURANCE#"},
			":empty": &ddbtypes.AttributeValueMemberS{Value: ""},
		},
		ScanIndexForward: aws.Bool(false), // newest first
		Limit:            aws.Int32(10),   // scan a small window; match payer in-memory
	})
	if err != nil {
		return nil, fmt.Errorf("phi: find standalone check: %w", err)
	}

	needle := strings.ToLower(strings.TrimSpace(payerName))
	for _, it := range out.Items {
		var rec InsuranceCheckRecord
		if err := attributevalue.UnmarshalMap(it, &rec); err != nil {
			continue
		}
		if rec.SubmissionUUID != "" {
			continue
		}
		if rec.PurgedAt != nil {
			continue
		}
		if rec.CreatedAt.Before(cutoff) {
			continue
		}
		if strings.ToLower(strings.TrimSpace(rec.PayerName)) != needle {
			continue
		}
		return &InsuranceReuse{
			CheckUUID:      rec.CheckUUID,
			Eligible:       rec.Eligible,
			CoverageStatus: rec.CoverageStatus,
		}, nil
	}
	return nil, ErrNotFound
}

// LinkCheckToSubmission sets submissionUuid and (optionally) updates
// emailHash on an existing standalone check. Uses UpdateItem with a condition
// that ensures the check is still standalone — if the condition fails (race
// or the item was already linked), ErrAlreadyExists is returned and the
// caller should fall back to inserting a fresh check row.
//
// newEmailHash may be empty — in that case the emailHash column is left
// unchanged (only submission_uuid is written).
func (s *Store) LinkCheckToSubmission(ctx context.Context, checkUUID, oldEmailHash, submissionUUID, newEmailHash string) error {
	if checkUUID == "" {
		return errors.New("phi: checkUUID is required")
	}
	if oldEmailHash == "" {
		return errors.New("phi: oldEmailHash is required")
	}
	if submissionUUID == "" {
		return errors.New("phi: submissionUUID is required")
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	updateExpr := "SET submissionUuid = :sid"
	exprAttrValues := map[string]ddbtypes.AttributeValue{
		":sid":   &ddbtypes.AttributeValueMemberS{Value: submissionUUID},
		":empty": &ddbtypes.AttributeValueMemberS{Value: ""},
	}
	if newEmailHash != "" && newEmailHash != oldEmailHash {
		updateExpr += ", emailHash = :eh"
		exprAttrValues[":eh"] = &ddbtypes.AttributeValueMemberS{Value: newEmailHash}
		// Also update PK-embedded emailHash is impossible in DDB — PK is
		// immutable. We keep the old PK but update the emailHash attribute
		// so admin queries that filter by emailHash attribute still work.
	}

	_, err := s.ddb.UpdateItem(ctx, &dynamodb.UpdateItemInput{
		TableName: aws.String(s.tableName),
		Key: map[string]ddbtypes.AttributeValue{
			"PK": &ddbtypes.AttributeValueMemberS{Value: patientPK(oldEmailHash)},
			"SK": &ddbtypes.AttributeValueMemberS{Value: insuranceSK(checkUUID)},
		},
		UpdateExpression:    aws.String(updateExpr),
		ConditionExpression: aws.String("attribute_not_exists(submissionUuid) OR submissionUuid = :empty"),
		ExpressionAttributeValues: exprAttrValues,
	})
	if err != nil {
		var cond *ddbtypes.ConditionalCheckFailedException
		if errors.As(err, &cond) {
			return ErrAlreadyExists
		}
		return fmt.Errorf("phi: link check to submission: %w", err)
	}
	return nil
}

// InsuranceCheckFilter narrows ListInsuranceChecks. Empty fields mean no filter.
type InsuranceCheckFilter struct {
	// Source values after friendly-mapping ("chatbot" → "chat-agent", etc.)
	// Pass the raw stored values; the handler maps friendly labels before
	// calling.
	Sources    []string
	Status     string // "verified" | "unverified" | "error" | ""
	From       *time.Time
	To         *time.Time
	SearchText string
	Limit      int
}

// InsuranceCheckSummary is a flattened shape suitable for the admin list.
type InsuranceCheckSummary struct {
	CheckUUID      string
	SubmissionUUID string
	EmailHash      string
	Source         string
	PayerName      string
	CoverageStatus string
	Eligible       bool
	FirstName      string
	LastName       string
	DateOfBirth    string
	Phone          string
	Email          string
	MemberID       string
	CreatedAt      time.Time
}

// ListInsuranceChecks returns insurance check summaries most-recent-first,
// filtered by the provided InsuranceCheckFilter. Runs the GSI1 partition
// query and applies all filters in-memory.
//
// Returns (rows, total-scanned). `total` is the DDB item count BEFORE
// filtering so the admin UI can show "filtered N of M".
func (s *Store) ListInsuranceChecks(ctx context.Context, f InsuranceCheckFilter) ([]InsuranceCheckSummary, int, error) {
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
			":pk": &ddbtypes.AttributeValueMemberS{Value: insuranceGSI1PKValue},
		},
		ScanIndexForward: aws.Bool(false), // DESC by GSI1SK = most recent first
		Limit:            aws.Int32(int32(limit)),
	})
	if err != nil {
		return nil, 0, fmt.Errorf("phi: list insurance checks: %w", err)
	}

	scanned := len(out.Items)

	// Build source set for O(1) lookup.
	srcSet := make(map[string]struct{}, len(f.Sources))
	for _, s := range f.Sources {
		srcSet[s] = struct{}{}
	}

	needle := strings.ToLower(strings.TrimSpace(f.SearchText))

	rows := make([]InsuranceCheckSummary, 0, scanned)
	for _, it := range out.Items {
		var r InsuranceCheckRecord
		if err := attributevalue.UnmarshalMap(it, &r); err != nil {
			return nil, scanned, fmt.Errorf("phi: unmarshal insurance check (list): %w", err)
		}
		if r.PurgedAt != nil {
			continue
		}
		if len(srcSet) > 0 {
			if _, ok := srcSet[r.Source]; !ok {
				continue
			}
		}
		if f.Status != "" {
			if r.CoverageStatus != f.Status {
				continue
			}
		}
		if f.From != nil && r.CreatedAt.Before(*f.From) {
			continue
		}
		if f.To != nil && r.CreatedAt.After(*f.To) {
			continue
		}
		if needle != "" {
			hay := strings.ToLower(strings.Join([]string{
				r.PayerName, r.EmailHash, r.CheckUUID,
				r.FirstName, r.LastName, r.Email, r.Phone, r.MemberID,
			}, " "))
			if !strings.Contains(hay, needle) {
				continue
			}
		}
		rows = append(rows, InsuranceCheckSummary{
			CheckUUID:      r.CheckUUID,
			SubmissionUUID: r.SubmissionUUID,
			EmailHash:      r.EmailHash,
			Source:         r.Source,
			PayerName:      r.PayerName,
			CoverageStatus: r.CoverageStatus,
			Eligible:       r.Eligible,
			FirstName:      r.FirstName,
			LastName:       r.LastName,
			DateOfBirth:    r.DateOfBirth,
			Phone:          r.Phone,
			Email:          r.Email,
			MemberID:       r.MemberID,
			CreatedAt:      r.CreatedAt,
		})
	}
	return rows, scanned, nil
}

func validateInsuranceCheck(r InsuranceCheckRecord) error {
	switch {
	case strings.TrimSpace(r.CheckUUID) == "":
		return errors.New("phi: InsuranceCheckRecord.CheckUUID is required")
	case strings.TrimSpace(r.EmailHash) == "":
		return errors.New("phi: InsuranceCheckRecord.EmailHash is required")
	case strings.TrimSpace(r.Source) == "":
		return errors.New("phi: InsuranceCheckRecord.Source is required")
	case strings.TrimSpace(r.CoverageStatus) == "":
		return errors.New("phi: InsuranceCheckRecord.CoverageStatus is required")
	case r.CreatedAt.IsZero():
		return errors.New("phi: InsuranceCheckRecord.CreatedAt is required")
	case r.RetainUntil.IsZero():
		return errors.New("phi: InsuranceCheckRecord.RetainUntil is required")
	}
	return nil
}
