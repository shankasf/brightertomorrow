export const ACCOUNT = "502263855065";
export const REGION = "us-east-1";

export const ROOT_DOMAIN = "brightertomorrowtherapy.com";
export const ADMIN_DOMAIN = `admin.${ROOT_DOMAIN}`;
export const API_DOMAIN = `api.${ROOT_DOMAIN}`;

export const DDB_TABLE = "bt-main";
export const DDB_GSI1 = "GSI1";

export const DDB_JANE_EVENTS_TABLE = "bt-jane-events";
export const DDB_SOFT_HOLDS_TABLE = "bt-soft-holds";

// Notifications outbox — stores pending/retry/sent/dead delivery rows.
// Action nodes write rows here inside the booking TransactWriteItems.
export const DDB_NOTIFICATIONS_OUTBOX_TABLE = "bt-notifications-outbox";

// Pending intake requests — indexed for returning-patient lookup and admin queue.
export const DDB_PENDING_REQUESTS_TABLE = "bt-pending-requests";

// Admin handoff queue — routine clinical-intake handoff notifications.
// Written by bt-ai handoff terminal nodes (out_of_state, roi_required,
// admin_with_note, admin_verification, admin_callback).
export const DDB_ADMIN_QUEUE_TABLE = "bt-admin-queue";

// Safety queue — urgent clinical-safety escalations requiring immediate triage.
// Written by bt-ai handoff_mandatory_report and handoff_crisis nodes.
// Separate table from admin queue so IAM and alarms can be scoped differently.
export const DDB_SAFETY_QUEUE_TABLE = "bt-safety-queue";

// Twilio secret path in Secrets Manager (auth_token inside JSON blob).
export const SECRET_TWILIO = "bt/twilio/credentials";

// S3 bucket for PHI logs written by the s3_phi channel.
// Account-suffixed: S3 names are global and the old account (689517798275)
// still owns the unsuffixed names until it is decommissioned.
export const PHI_LOGS_BUCKET = `bt-phi-logs-${ACCOUNT}`;

// S3 bucket for operational app logs (frontend + gateway + bt-ai) shipped by
// Vector. CMK-encrypted, partitioned by service/yyyy/mm/dd/hh, Parquet.
export const APP_LOGS_BUCKET = `bt-app-logs-${ACCOUNT}`;

// Glue + Athena names for app-log analytics.
export const GLUE_LOG_DATABASE = "bt_logs";
export const GLUE_LOG_TABLE = "app_logs";
export const ATHENA_LOG_WORKGROUP = "bt-log-search";
// Per-query scan limit (bytes). 1 GB is plenty for a single search; anything
// larger would scan years of logs and probably means a missing WHERE clause.
export const ATHENA_LOG_QUERY_SCAN_LIMIT_BYTES = 1024 * 1024 * 1024;

export const JANE_STAFF_IDS = [47, 24, 21, 34, 53, 59, 16, 45, 66] as const;

export const SECRET_NAMES = {
  CLAIM_MD: "bt/claim-md/account-key",
  CLAIM_MD_PROVIDER: "bt/claim-md/provider",
  OPENAI: "bt/openai/api-key",
  HOSTINGER: "bt/hostinger/api-token",
  COGNITO_BOOTSTRAP: "bt/cognito/bootstrap-admin",
} as const;

export const BOOTSTRAP_ADMIN_EMAIL = "sagar@callsphere.tech";

export const KMS_ALIAS = "alias/bt-phi";

export const LOG_RETENTION_DAYS = 400;
