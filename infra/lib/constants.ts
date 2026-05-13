export const ACCOUNT = "689517798275";
export const REGION = "us-east-1";

export const ROOT_DOMAIN = "brightertomorrowtherapy.cloud";
export const ADMIN_DOMAIN = `admin.${ROOT_DOMAIN}`;
export const API_DOMAIN = `api.${ROOT_DOMAIN}`;

export const DDB_TABLE = "bt-main";
export const DDB_GSI1 = "GSI1";

export const DDB_JANE_EVENTS_TABLE = "bt-jane-events";
export const DDB_SOFT_HOLDS_TABLE = "bt-soft-holds";

export const JANE_STAFF_IDS = [71, 47, 24, 21, 34, 53] as const;

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
