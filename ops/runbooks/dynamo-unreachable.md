# Runbook: DynamoDB Unreachable — Intake Submissions Failing

**Severity**: P1 — intake is down  
**Escalation**: Page Sagar (sagar@callsphere.tech) if intake is down more than 5 minutes.

---

## TL;DR

The gateway writes all intake PHI to DynamoDB `bt-main` (us-east-1, CMK `alias/bt-phi`) as its first action on every `/v1/intake` POST. If the write fails for any reason, the gateway returns **HTTP 503** with error code `phi_store_unavailable` and drops the request entirely — no PHI is written anywhere, the user sees a failure.

**Fail-closed is intentional.** Accepting intake data we cannot durably store on the CMK-encrypted table would be a HIPAA violation. Do not attempt to bypass this by commenting out the DynamoDB write.

---

## Triage in 60 seconds

Run these three commands. They will tell you where the break is.

**1. Check what the gateway is logging:**
```
kubectl -n bt logs -l app=bt-gateway --tail=50 | grep -i 'phi'
```
Look for: `phi_store_unavailable`, `InvalidClientTokenId`, `SignatureDoesNotMatch`, `AccessDeniedException`, `ResourceNotFoundException`, connection timeouts.

**2. Hit the readiness endpoint directly from the pod:**
```
kubectl -n bt exec deploy/bt-gateway -- wget -qO- http://localhost:8080/readyz
```
A healthy gateway returns `200 OK`. An unhealthy one returns `503` and a JSON body with a `reason` field naming the failing component (e.g., `"dynamo_unreachable"`).

**3. Verify the table itself responds from your laptop:**
```
aws dynamodb describe-table --table-name bt-main --region us-east-1
```
If this returns a table description, the table exists and AWS-side is fine. If it returns `ResourceNotFoundException`, go directly to cause 5 below.

---

## Causes, in order of likelihood

### 1. VM-to-AWS network blip

The Hostinger VM (2.24.200.155) reaches DynamoDB over the public internet. Transient network issues are the most common cause.

**Test from inside the pod:**
```
kubectl -n bt exec deploy/bt-gateway -- wget -qO- https://dynamodb.us-east-1.amazonaws.com 2>&1 | head -5
```
A healthy connection returns a 400 (expected — no valid request body) or TLS handshake details. A broken connection hangs or shows `Connection refused` / `Name or service not known`.

**Fix:** Wait 30 seconds and recheck. If the problem persists beyond 2 minutes, check the Hostinger network console for outbound connectivity issues on the VM. This is outside Kubernetes — it is a VM-level problem.

---

### 2. Expired or rotated IAM access key

Gateway logs will contain `InvalidClientTokenId` or `SignatureDoesNotMatch`.

**Fix:** See "Rotate the IAM key" section below.

---

### 3. CMK access denied

Gateway logs will contain `AccessDeniedException` with the word `kms:Decrypt` or `kms:GenerateDataKey`.

This means the IAM user `bt-gateway-vm` no longer has permission to use CMK `alias/bt-phi`. The most common cause is a drift in the `BtGatewayIam` CDK stack — someone may have deployed an infrastructure change that narrowed the KMS policy.

**Fix:**
```
cd infra && npx cdk deploy BtGatewayIam
```
The KMS grant for `alias/bt-phi` is declared in that stack. Redeploying restores it without touching the access key. After deploy, restart the gateway and confirm `/readyz` returns 200.

---

### 4. DynamoDB table throttling

Unlikely — `bt-main` is `PAY_PER_REQUEST` (on-demand), which has no provisioned throughput to exhaust. However, AWS does enforce per-account burst limits.

**Check:** In the AWS console (or via CLI), look at CloudWatch metric `ProvisionedThroughputExceededException` on table `bt-main` in `us-east-1`. Gateway logs will also show `ProvisionedThroughputExceededException` from the AWS SDK.

**Fix:** If real, open an AWS Support ticket requesting a burst limit increase. This cannot be self-served. While waiting, the gateway will continue to fail-closed.

---

### 5. Table deleted or stack drift (major incident)

`aws dynamodb describe-table --table-name bt-main --region us-east-1` returns `ResourceNotFoundException`.

This is a major incident. PITR (point-in-time recovery) is enabled on `bt-main`.

**Restore procedure:**
```
aws dynamodb restore-table-to-point-in-time \
  --source-table-name bt-main \
  --target-table-name bt-main-restored \
  --restore-date-time <ISO-8601 timestamp, e.g. 2026-05-09T02:00:00Z>
```
Once `bt-main-restored` is `ACTIVE`, rename it (DynamoDB does not support in-place rename — you will need to update `BT_DDB_TABLE` in the k8s Secret and restart the gateway). Coordinate with Sagar before taking any action here.

---

## Where the IAM keys live

| Location | Detail |
|---|---|
| AWS Secrets Manager | Secret ID: `bt/gateway/aws-credentials`, account 689517798275, region us-east-1 |
| Kubernetes | Secret `bt-config` in namespace `bt`, keys `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` |

**Read the current Secrets Manager value:**
```
aws secretsmanager get-secret-value \
  --secret-id bt/gateway/aws-credentials \
  --query SecretString \
  --output text | jq
```

**Inspect what the pod currently sees (does not reveal the value — only confirms the key is mounted):**
```
kubectl -n bt exec deploy/bt-gateway -- printenv | grep AWS_ACCESS_KEY_ID
```

---

## Rotate the IAM key

Follow these steps in order. Do not skip the rollout restart — the pod caches env vars at startup.

**Step 1.** Rotate via CDK (creates a new key, updates Secrets Manager):
```
cd infra && npx cdk deploy BtGatewayIam
```

**Step 2.** Read the new key values from Secrets Manager:
```
aws secretsmanager get-secret-value \
  --secret-id bt/gateway/aws-credentials \
  --query SecretString \
  --output text | jq
```

**Step 3.** Update the Kubernetes Secret with the new values. Never edit `k8s/10-secrets.yaml` in-place if you have the real file; instead use kubectl directly:
```
kubectl -n bt create secret generic bt-config \
  --from-literal=AWS_ACCESS_KEY_ID=<new-key-id> \
  --from-literal=AWS_SECRET_ACCESS_KEY=<new-secret> \
  --dry-run=client -o yaml | kubectl apply -f -
```
This merges only the two specified keys and leaves all other keys in `bt-config` untouched.

**Step 4.** Restart the gateway pod to pick up the new env vars:
```
kubectl -n bt rollout restart deploy/bt-gateway
```

**Step 5.** Confirm recovery:
```
curl -s https://api.brightertomorrowtherapy.cloud/readyz
```
Expect `200 OK`. If still failing, check logs again (`kubectl -n bt logs -l app=bt-gateway --tail=20`).

**Step 6.** The old key remains valid for approximately 24 hours. To immediately revoke it:
```
aws iam delete-access-key \
  --user-name bt-gateway-vm \
  --access-key-id <OLD_KEY_ID>
```

---

## Emergency rollback: Postgres-only intake

**Use this only if DynamoDB is unrecoverable in the short term and you must accept intake submissions.**

This is a temporary HIPAA downgrade. It must be treated as an active incident and reversed within the same on-call shift.

**Step 1.** Find the pre-migration commit:
```
git log --oneline gateway/internal/handlers/intake.go | grep -i dynamo
```
The commit message will reference "Dynamo-first intake". Note the commit hash immediately before it.

**Step 2.** Revert the file:
```
git show <pre-migration-hash>:gateway/internal/handlers/intake.go > gateway/internal/handlers/intake.go
```

**Step 3.** Rebuild and reload:
```
make build-gateway && kubectl -n bt rollout restart deploy/bt-gateway
```
(See `ops/build-and-deploy.md` for the rebuild + rollout flow.)

**Step 4.** Verify intake responds:
```
curl -s -X POST https://api.brightertomorrowtherapy.cloud/v1/intake \
  -H 'Content-Type: application/json' \
  -d '{"test":true}' | head -c 200
```

**Step 5.** File an incident immediately. Tag it `phi-compliance-gap`. Sagar must be aware within 5 minutes regardless of time of day.

---

## Escalation

Page **Sagar** at sagar@callsphere.tech if:

- Intake is down more than 5 minutes.
- You are using the emergency Postgres-only rollback.
- The DynamoDB table is missing (`ResourceNotFoundException`).
- You see any evidence of unauthorized access (unexpected `AccessDeniedException` with an unknown principal).
