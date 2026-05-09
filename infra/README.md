# bt-infra — AWS HIPAA Stack (CDK TypeScript)

Deploys the AWS portion of BrighterTomorrow Therapy:

- **KMS CMK** (`alias/bt-phi`) — encrypts DynamoDB, S3, CloudWatch Logs, Secrets Manager, SNS
- **DynamoDB** `bt-main` (single-table, PITR, streams, CMK-encrypted, deletion protection)
- **Secrets Manager** — CLAIM.MD AccountKey, OpenAI API key, Hostinger DNS token (shells only; values written out-of-band)
- **Cognito** user pool with mandatory TOTP MFA, email sign-in, no SMS
- **API Gateway** REST at `api.brightertomorrowtherapy.cloud`
  - `POST /internal/insurance/verify` — IAM/SigV4 (called by `bt-ai`)
  - `POST /internal/chat/turn` — IAM/SigV4 (called by `bt-ai`)
  - `GET /patients/{patient_id}` — Cognito JWT
  - `GET /dashboard/metrics` — Cognito JWT
- **Lambdas** (Python 3.12, outside VPC): `verifyInsurance`, `handleChat`, `getPatientData`, `getDashboardMetrics`
- **S3 + CloudFront** SPA at `admin.brightertomorrowtherapy.cloud` (OAC, HSTS, strict CSP)
- **CloudTrail** multi-region, file validation, CMK-encrypted bucket with Object Lock (compliance, 1y)
- **CloudWatch** alarms for 4xx/5xx and DynamoDB throttles → SNS email

## Phased deploy

```bash
# one-time
cd infra && npm ci
npx cdk bootstrap aws://689517798275/us-east-1

# phase 1 — security, data, observability
npm run deploy:phase1

# seed secret values (NEVER in templates)
aws secretsmanager put-secret-value --secret-id bt/claim-md/account-key --secret-string "$CLAIM_MD_KEY"
aws secretsmanager put-secret-value --secret-id bt/openai/api-key       --secret-string "$OPENAI_KEY"
aws secretsmanager put-secret-value --secret-id bt/hostinger/api-token  --secret-string "$HOSTINGER_TOKEN"

# phase 2 — cognito
npm run deploy:phase2

# phase 3 — lambdas + API Gateway (adds ACM cert + Hostinger CNAME for api.)
npm run deploy:phase3

# phase 4 — admin SPA (adds ACM cert + Hostinger CNAME for admin.)
npm run deploy:phase4
```

## Environment

- Account: `689517798275`
- Region: `us-east-1`
- Root domain: `brightertomorrowtherapy.cloud` (DNS at Hostinger)

## HIPAA posture

- KMS-encrypted at rest for every PHI-touching resource
- TLS 1.2+ everywhere; HSTS on CloudFront
- Cognito with enforced TOTP MFA + advanced security
- No PHI in CloudWatch logs (structured JSON logger with field-level redaction)
- CloudTrail with Object Lock + log file validation
- Least-privilege IAM per Lambda (no wildcard actions on PHI resources)
- DynamoDB PITR on; deletion protection on
- BAAs in place with AWS, OpenAI (ZDR), CLAIM.MD
