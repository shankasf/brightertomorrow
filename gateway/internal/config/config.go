package config

import (
	"errors"
	"os"
	"strings"
)

// Config holds all runtime configuration for the gateway.
type Config struct {
	Port                 string
	DatabaseURL          string
	AIServiceURL         string
	LogLevel             string
	CORSOrigins          []string
	CookieSecure         bool
	AdminInitialEmail    string
	AdminInitialPassword string
	// DDB / PHI store.
	DDBTable  string
	AWSRegion string
	// Cognito (admin login). When unset, /admin/api/auth/exchange returns 503.
	CognitoUserPoolID string
	CognitoClientID   string
	// Calendar DDB tables (created by infra agent).
	JaneEventsTable string
	SoftHoldsTable  string
	// Clinical-intake gate / handoff tables.
	PendingRequestsTable string // bt-pending-requests — returning-patient lookup
	AdminQueueTable      string // bt-admin-queue — routine handoff notifications
	SafetyQueueTable     string // bt-safety-queue — urgent safety escalations
	SNSAlertTopicARN            string // ARN of bt-alerts SNS topic; safety_queue publishes here
	NotificationsOutboxTable    string // bt-notifications-outbox — patient notification queue
	NotificationsRetryLambda    string // bt-notifications-retry Lambda function name (BT_NOTIFICATIONS_RETRY_LAMBDA)
	// AppointmentNotifyEnabled gates the patient notification enqueue in
	// UpdateStatus. Default FALSE — the gateway IAM role's kms:Encrypt grant
	// is conditioned on kms:ViaService=dynamodb/sns only, so a direct KMS
	// encrypt from the gateway will fail with AccessDenied until infra is
	// provisioned. Set BT_APPOINTMENT_NOTIFY_ENABLED=true to enable.
	AppointmentNotifyEnabled bool
	// Shared secret for /internal/calendar/* endpoints. When empty the check
	// is skipped (dev mode); in production this must be set.
	InternalAPISecret string
	// Twilio Voice.
	//
	//   TwilioAuthToken    — verifies X-Twilio-Signature on inbound webhook +
	//                        Media Streams WS upgrades. REQUIRED today.
	//   TwilioPublicHost   — host Twilio dials us on; must match the webhook
	//                        URL on the Twilio number exactly.
	//   TwilioAccountSid   — "AC…"; future outbound REST API base path.
	//   TwilioAPIKeySid    — "SK…"; preferred basic-auth user for outbound.
	//   TwilioAPIKeySecret — paired secret.
	//
	// Outbound fields are loaded but not used yet — wired so adding outbound
	// features won't require a secrets/config rollout.
	TwilioAuthToken    string
	TwilioPublicHost   string
	TwilioAccountSid   string
	TwilioAPIKeySid    string
	TwilioAPIKeySecret string
}

var ErrMissingDatabaseURL = errors.New("config: DATABASE_URL is required")

// Load reads configuration from environment variables and applies defaults.
func Load() (*Config, error) {
	port := envOr("PORT", "8080")
	databaseURL := os.Getenv("DATABASE_URL")
	aiServiceURL := envOr("AI_SERVICE_URL", "http://127.0.0.1:8001")
	logLevel := envOr("LOG_LEVEL", "info")
	rawOrigins := envOr("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001")

	if databaseURL == "" {
		return nil, ErrMissingDatabaseURL
	}

	origins := splitTrimmed(rawOrigins, ",")
	cookieSecure := os.Getenv("COOKIE_SECURE") != "false"

	return &Config{
		Port:                 port,
		DatabaseURL:          databaseURL,
		AIServiceURL:         aiServiceURL,
		LogLevel:             logLevel,
		CORSOrigins:          origins,
		CookieSecure:         cookieSecure,
		AdminInitialEmail:    os.Getenv("ADMIN_INITIAL_EMAIL"),
		AdminInitialPassword: os.Getenv("ADMIN_INITIAL_PASSWORD"),
		DDBTable:             envOr("BT_DDB_TABLE", "bt-main"),
		AWSRegion:            envOr("BT_DDB_REGION", "us-east-1"),
		CognitoUserPoolID:    os.Getenv("COGNITO_USER_POOL_ID"),
		CognitoClientID:      os.Getenv("COGNITO_USER_POOL_CLIENT_ID"),
		JaneEventsTable:      envOr("BT_JANE_EVENTS_TABLE", "bt-jane-events"),
		SoftHoldsTable:       envOr("BT_SOFT_HOLDS_TABLE", "bt-soft-holds"),
		PendingRequestsTable: envOr("BT_PENDING_REQUESTS_TABLE", "bt-pending-requests"),
		AdminQueueTable:      envOr("BT_ADMIN_QUEUE_TABLE", "bt-admin-queue"),
		SafetyQueueTable:     envOr("BT_SAFETY_QUEUE_TABLE", "bt-safety-queue"),
		SNSAlertTopicARN:            os.Getenv("SNS_ALERT_TOPIC_ARN"),
		NotificationsOutboxTable:    envOr("BT_NOTIFICATIONS_OUTBOX_TABLE", "bt-notifications-outbox"),
		NotificationsRetryLambda:    envOr("BT_NOTIFICATIONS_RETRY_LAMBDA", "bt-notifications-retry"),
		AppointmentNotifyEnabled: parseBool(os.Getenv("BT_APPOINTMENT_NOTIFY_ENABLED")),
		InternalAPISecret:        os.Getenv("INTERNAL_API_SECRET"),
		TwilioAuthToken:      os.Getenv("TWILIO_AUTH_TOKEN"),
		TwilioPublicHost:     envOr("TWILIO_PUBLIC_HOST", "brightertomorrowtherapy.com"),
		TwilioAccountSid:     os.Getenv("TWILIO_ACCOUNT_SID"),
		TwilioAPIKeySid:      os.Getenv("TWILIO_API_KEY_SID"),
		TwilioAPIKeySecret:   os.Getenv("TWILIO_API_KEY_SECRET"),
	}, nil
}

func envOr(key, defaultVal string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultVal
}

// parseBool returns true for "1", "true", "yes", "on" (case-insensitive).
// All other values, including the empty string, return false.
func parseBool(s string) bool {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

func splitTrimmed(s, sep string) []string {
	parts := strings.Split(s, sep)
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}
