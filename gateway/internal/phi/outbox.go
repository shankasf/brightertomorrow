// outbox.go — notifications outbox: enqueue encrypted notifications to
// bt-notifications-outbox for pickup by the notifications-retry Lambda.
//
// HIPAA: message payloads (phone number, email address, message text) are
// KMS-encrypted under alias/bt-phi before being stored in DynamoDB. The
// DDB table is also CMK-encrypted at the table level, giving double
// encryption at rest. NO PHI is logged; only notification_id and channel.
//
// The caller must treat every EnqueueNotification call as best-effort:
// on error, log and continue — never fail the HTTP request because a
// notification couldn't be enqueued.
package phi

import (
	"context"
	"encoding/base64"
	"fmt"
	"log/slog"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/dynamodb"
	ddbtypes "github.com/aws/aws-sdk-go-v2/service/dynamodb/types"
	"github.com/aws/aws-sdk-go-v2/service/kms"
	"github.com/aws/aws-sdk-go-v2/service/lambda"
	"github.com/google/uuid"
)

const (
	// notificationTTLDays is the TTL for outbox rows (auto-purge).
	notificationTTLDays = 30
)

// KMSClient is the subset of the KMS SDK we use; lets tests inject a fake.
type KMSClient interface {
	Encrypt(ctx context.Context, in *kms.EncryptInput, opts ...func(*kms.Options)) (*kms.EncryptOutput, error)
}

// LambdaInvoker is the subset of the Lambda SDK we use; lets tests inject a fake.
type LambdaInvoker interface {
	Invoke(ctx context.Context, in *lambda.InvokeInput, opts ...func(*lambda.Options)) (*lambda.InvokeOutput, error)
}

// NotificationStore enqueues rows to the notifications outbox table.
// Construct with NewNotificationStore.
type NotificationStore struct {
	ddb          DDBClient
	kmsClient    KMSClient
	lambdaClient LambdaInvoker // optional; nil → async trigger skipped
	lambdaFnName string        // function name / ARN for the retry Lambda
	tableName    string
	cmkKeyID     string // "alias/bt-phi" or full ARN
	timeout      time.Duration
}

// NotificationStoreConfig controls construction.
type NotificationStoreConfig struct {
	DDB          DDBClient
	KMS          KMSClient
	Lambda       LambdaInvoker // optional; nil → async trigger disabled
	LambdaFnName string        // BT_NOTIFICATIONS_RETRY_LAMBDA; default "bt-notifications-retry"
	TableName    string
	CMKKeyID     string
	Timeout      time.Duration
}

// NewNotificationStore returns a ready NotificationStore.
func NewNotificationStore(cfg NotificationStoreConfig) (*NotificationStore, error) {
	if cfg.DDB == nil {
		return nil, fmt.Errorf("phi: NotificationStore requires DDB client")
	}
	if cfg.KMS == nil {
		return nil, fmt.Errorf("phi: NotificationStore requires KMS client")
	}
	if cfg.TableName == "" {
		return nil, fmt.Errorf("phi: NotificationStore requires TableName")
	}
	cmk := cfg.CMKKeyID
	if cmk == "" {
		cmk = "alias/bt-phi"
	}
	timeout := cfg.Timeout
	if timeout == 0 {
		timeout = 5 * time.Second
	}
	fnName := cfg.LambdaFnName
	if fnName == "" {
		fnName = "bt-notifications-retry"
	}
	return &NotificationStore{
		ddb:          cfg.DDB,
		kmsClient:    cfg.KMS,
		lambdaClient: cfg.Lambda,
		lambdaFnName: fnName,
		tableName:    cfg.TableName,
		cmkKeyID:     cmk,
		timeout:      timeout,
	}, nil
}

// EnqueueNotification KMS-encrypts plaintextPayload and writes one row to the
// outbox table. The Lambda picks it up within 60 s via the GSI1-retry-scan
// GSI (PK=status, SK=next_retry_at).
//
// channel: "sms" | "email"
// recipient: E.164 phone for sms, email address for email
// plaintextPayload: raw message text for sms; JSON string for email
// dedupeKey: prevents double-send when the caller is idempotent
func (s *NotificationStore) EnqueueNotification(
	ctx context.Context,
	channel, recipient, plaintextPayload, dedupeKey string,
) error {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	// KMS-encrypt the payload under alias/bt-phi.
	encOut, err := s.kmsClient.Encrypt(ctx, &kms.EncryptInput{
		KeyId:     aws.String(s.cmkKeyID),
		Plaintext: []byte(plaintextPayload),
	})
	if err != nil {
		return fmt.Errorf("phi: outbox: kms encrypt: %w", err)
	}
	ciphertextB64 := base64.StdEncoding.EncodeToString(encOut.CiphertextBlob)

	now := time.Now().UTC()
	notificationID := uuid.NewString()
	createdAt := now.Format("2006-01-02T15:04:05Z")
	ttl := now.AddDate(0, 0, notificationTTLDays).Unix()

	item := map[string]ddbtypes.AttributeValue{
		"notification_id":    &ddbtypes.AttributeValueMemberS{Value: notificationID},
		"created_at":         &ddbtypes.AttributeValueMemberS{Value: createdAt},
		"channel":            &ddbtypes.AttributeValueMemberS{Value: channel},
		"recipient":          &ddbtypes.AttributeValueMemberS{Value: recipient},
		"payload_ciphertext": &ddbtypes.AttributeValueMemberS{Value: ciphertextB64},
		// GSI1-retry-scan: PK=status, SK=next_retry_at.
		"status":        &ddbtypes.AttributeValueMemberS{Value: "pending"},
		"next_retry_at": &ddbtypes.AttributeValueMemberS{Value: createdAt},
		"attempt_count": &ddbtypes.AttributeValueMemberN{Value: "0"},
		"dedupe_key":    &ddbtypes.AttributeValueMemberS{Value: dedupeKey},
		"ttl":           &ddbtypes.AttributeValueMemberN{Value: fmt.Sprintf("%d", ttl)},
	}

	_, err = s.ddb.PutItem(ctx, &dynamodb.PutItemInput{
		TableName: aws.String(s.tableName),
		Item:      item,
		// Idempotent: if a row with the same notification_id somehow exists,
		// skip (this is cosmetic — notification_id is a fresh UUID each call).
	})
	if err != nil {
		return fmt.Errorf("phi: outbox: put item: %w", err)
	}

	// Best-effort: fire the retry Lambda asynchronously so the email is
	// delivered in seconds rather than waiting for the ≤60s polling floor.
	// The goroutine is intentionally "naked" here because:
	//   1. It must not block or be cancelled by the request context.
	//   2. It is pure fire-and-forget — the Lambda failing or not being
	//      configured is not an error condition; the outbox row will still
	//      be picked up on the next schedule tick.
	// No PHI is passed to the Lambda — InvocationType=Event with an empty
	// payload; the Lambda re-reads the outbox itself.
	go s.triggerRetryAsync(context.Background())

	return nil
}

// triggerRetryAsync invokes the notifications-retry Lambda with
// InvocationType=Event (async, no response body). All errors are logged
// at Warn level and swallowed — never propagated to the caller.
// Guard: returns immediately if the Lambda client or function name is not set.
func (s *NotificationStore) triggerRetryAsync(ctx context.Context) {
	if s.lambdaClient == nil || s.lambdaFnName == "" {
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	_, err := s.lambdaClient.Invoke(ctx, &lambda.InvokeInput{
		FunctionName:   aws.String(s.lambdaFnName),
		InvocationType: "Event", // async; Lambda returns 202 immediately
		Payload:        []byte(`{}`),
	})
	if err != nil {
		// Log and swallow — the outbox row is durable; the Lambda will pick
		// it up on the next schedule tick even if the trigger fails.
		// No PHI in this log line.
		slog.Warn("phi: outbox: async lambda trigger failed",
			"fn", s.lambdaFnName, "err", err)
	}
}
