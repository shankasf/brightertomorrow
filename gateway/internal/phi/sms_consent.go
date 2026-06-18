// sms_consent.go — DynamoDB persistence for A2P/10DLC SMS opt-in consent.
//
// Why this lives in DDB and not Postgres
// ======================================
// A consent record ties a phone number to "this person agreed to receive
// texts from a mental-health practice" — that linkage is PHI/PII. Hostinger
// Postgres is not BAA-covered, so consent goes to the CMK-encrypted, BAA-
// covered bt-main table alongside every other identifier. This is also why
// the website CONTACT form (which itself lands in Postgres) writes its SMS
// consent here instead of as a Postgres column.
//
// Single-table key shape (one current-state item per phone; history lives in
// the immutable PHI audit log, so we overwrite the item on opt-in/opt-out):
//
//	PK     = "CONSENT#SMS#<phoneHash>"   (HashPhone — last-10-digit SHA-256)
//	SK     = "META"
//	GSI1PK = "ENTITY#SMS_CONSENT"        (admin/send-pipeline list query)
//	GSI1SK = "<RFC3339Nano updatedAt>#<phoneHash>"
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

// SMSConsentVersion identifies the consent-disclosure wording the user agreed
// to. Bump when the opt-in language materially changes so each record is
// attributable to a specific disclosure version.
//
// v2 (2026-06): appointment (transactional) consent and marketing consent are
// now captured as two separate, independently-revocable opt-ins. TCR/A2P
// rejects campaigns that bundle marketing consent with transactional consent,
// so each Scope is stored as its own item per phone number.
const SMSConsentVersion = "2026-06-v2"

const (
	smsConsentGSI1PK    = "ENTITY#SMS_CONSENT"
	smsConsentRetainYrs = 7 // mirror the audit retention; consent proof is long-lived
)

// SMSConsentScope separates the two consents A2P requires be collected apart.
// A recipient may opt in to appointment texts only, marketing only, or both.
const (
	SMSScopeTransactional = "transactional" // appointment confirmations/reminders/changes
	SMSScopeMarketing     = "marketing"     // practice updates, win-back outreach
)

var validSMSScopes = map[string]bool{
	SMSScopeTransactional: true, SMSScopeMarketing: true,
}

// smsConsentSK is the sort key for a given scope. One item per (phone, scope)
// so the two consents are independently set, queried, and revoked.
func smsConsentSK(scope string) string { return "META#" + scope }

// SMSConsentMethod values — how the opt-in was captured.
const (
	SMSMethodWebContact = "web_contact"
	SMSMethodWebBooking = "web_booking"
	SMSMethodChat       = "chat"
	SMSMethodVoice      = "voice"
	SMSMethodKeyword    = "keyword"
)

var validSMSMethods = map[string]bool{
	SMSMethodWebContact: true, SMSMethodWebBooking: true,
	SMSMethodChat: true, SMSMethodVoice: true, SMSMethodKeyword: true,
}

func smsConsentPK(phoneHash string) string { return "CONSENT#SMS#" + phoneHash }

// SMSConsentInput is what a caller supplies; the Store derives the hash,
// version, and timestamps.
type SMSConsentInput struct {
	Phone     string // raw; hashed on ingress, also stored (CMK-encrypted at rest)
	OptedIn   bool
	Method    string // one of the SMSMethod* constants
	Scope     string // SMSScope* — empty defaults to transactional (back-compat)
	Source    string // channel / agent_source (chat-agent | voice-agent | web | ...)
	SessionID string // optional — conversation/session that captured consent
}

// SMSConsentRecord is the stored shape.
type SMSConsentRecord struct {
	PhoneHash          string    `dynamodbav:"phoneHash"`
	Phone              string    `dynamodbav:"phone"` // CMK-encrypted at rest; needed by the future send pipeline
	OptedIn            bool      `dynamodbav:"optedIn"`
	Method             string    `dynamodbav:"method"`
	Scope              string    `dynamodbav:"scope"`
	Source             string    `dynamodbav:"source"`
	SessionID          string    `dynamodbav:"sessionId,omitempty"`
	ConsentTextVersion string    `dynamodbav:"consentTextVersion"`
	CreatedAt          time.Time `dynamodbav:"createdAt"`
	UpdatedAt          time.Time `dynamodbav:"updatedAt"`
	RetainUntil        time.Time `dynamodbav:"retainUntil"`
}

// PutSMSConsent upserts the current SMS-consent state for a phone number.
// Upsert (not insert-once) is intentional: a number can opt in, later reply
// STOP (opt-out), then opt in again — latest wins. Every write is captured in
// the 7-year PHI audit log, so the change history is preserved even though the
// item itself is overwritten. The audit newValues carry only the boolean and
// method — never the raw phone number.
func (s *Store) PutSMSConsent(ctx context.Context, in SMSConsentInput) error {
	phone := strings.TrimSpace(in.Phone)
	if phone == "" {
		return errors.New("phi: sms consent phone is required")
	}
	if !validSMSMethods[in.Method] {
		return fmt.Errorf("phi: invalid sms consent method %q", in.Method)
	}
	scope := strings.TrimSpace(in.Scope)
	if scope == "" {
		scope = SMSScopeTransactional // back-compat: conversational/legacy callers
	}
	if !validSMSScopes[scope] {
		return fmt.Errorf("phi: invalid sms consent scope %q", scope)
	}
	phoneHash := HashPhone(phone)
	if phoneHash == "" {
		return errors.New("phi: sms consent phone has no digits")
	}

	now := time.Now().UTC()
	rec := SMSConsentRecord{
		PhoneHash:          phoneHash,
		Phone:              phone,
		OptedIn:            in.OptedIn,
		Method:             in.Method,
		Scope:              scope,
		Source:             strings.TrimSpace(in.Source),
		SessionID:          strings.TrimSpace(in.SessionID),
		ConsentTextVersion: SMSConsentVersion,
		CreatedAt:          now,
		UpdatedAt:          now,
		RetainUntil:        now.AddDate(smsConsentRetainYrs, 0, 0),
	}

	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	item, err := attributevalue.MarshalMap(rec)
	if err != nil {
		return fmt.Errorf("phi: marshal sms consent: %w", err)
	}
	item["PK"] = &ddbtypes.AttributeValueMemberS{Value: smsConsentPK(phoneHash)}
	item["SK"] = &ddbtypes.AttributeValueMemberS{Value: smsConsentSK(scope)}
	item["GSI1PK"] = &ddbtypes.AttributeValueMemberS{Value: smsConsentGSI1PK}
	item["GSI1SK"] = &ddbtypes.AttributeValueMemberS{
		Value: now.Format(time.RFC3339Nano) + "#" + phoneHash + "#" + scope,
	}

	// No ConditionExpression — overwrite is the desired upsert semantics.
	if _, err := s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      item,
	}); err != nil {
		return fmt.Errorf("phi: put sms consent: %w", err)
	}

	s.auditPHI("sms_consent", "UPSERT", "SMS#"+phoneHash+"#"+scope, actorFromContext(ctx),
		fmt.Sprintf(`{"opted_in":%v,"method":%q,"scope":%q}`, in.OptedIn, in.Method, scope))
	return nil
}

// GetSMSConsent returns the current consent state for a phone and scope, or
// (nil, nil) if none exists. The send pipeline gates outbound texts on the
// matching scope: transactional for appointment messages, marketing for
// win-back/practice-update messages. Empty scope defaults to transactional.
func (s *Store) GetSMSConsent(ctx context.Context, phone, scope string) (*SMSConsentRecord, error) {
	phoneHash := HashPhone(strings.TrimSpace(phone))
	if phoneHash == "" {
		return nil, nil
	}
	scope = strings.TrimSpace(scope)
	if scope == "" {
		scope = SMSScopeTransactional
	}
	if !validSMSScopes[scope] {
		return nil, fmt.Errorf("phi: invalid sms consent scope %q", scope)
	}
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	out, err := s.ddb.GetItem(ctx, &dynamodb.GetItemInput{
		TableName: aws.String(s.tableName),
		Key: map[string]ddbtypes.AttributeValue{
			"PK": &ddbtypes.AttributeValueMemberS{Value: smsConsentPK(phoneHash)},
			"SK": &ddbtypes.AttributeValueMemberS{Value: smsConsentSK(scope)},
		},
	})
	if err != nil {
		return nil, fmt.Errorf("phi: get sms consent: %w", err)
	}
	if len(out.Item) == 0 {
		return nil, nil
	}
	var rec SMSConsentRecord
	if err := attributevalue.UnmarshalMap(out.Item, &rec); err != nil {
		return nil, fmt.Errorf("phi: unmarshal sms consent: %w", err)
	}
	return &rec, nil
}
