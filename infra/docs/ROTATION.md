# Secret rotation runbook

All runtime secrets live in AWS Secrets Manager (KMS-encrypted with the PHI CMK).
None are stored in CDK templates. Rotate by calling `put-secret-value` — Lambdas
pick up the new value on next invocation (cached TTL in `bt_common.secrets` is
the lifetime of the Lambda execution environment).

## CLAIM.MD AccountKey — `bt/claim-md/account-key`

1. Log into CLAIM.MD portal, regenerate AccountKey.
2. `aws secretsmanager put-secret-value --region us-east-1 --secret-id bt/claim-md/account-key --secret-string 'NEW_KEY'`
3. Test: trigger a `verify_insurance` call from the voice agent or run the
   Lambda directly with a test event.
4. Revoke the old key in the CLAIM.MD portal.

## OpenAI API key — `bt/openai/api-key`

1. OpenAI dashboard → API keys → create new, note it.
2. `aws secretsmanager put-secret-value --region us-east-1 --secret-id bt/openai/api-key --secret-string 'sk-...'`
3. (If OpenAI-in-Lambda is wired up) trigger a `handle_chat` call. For now this
   key is only used from inside `bt-ai` — set it in `bt-config` k8s secret too.
4. Revoke the old key in OpenAI.

## Hostinger API token — `bt/hostinger/api-token`

1. Hostinger control panel → regenerate API token.
2. `aws secretsmanager put-secret-value --region us-east-1 --secret-id bt/hostinger/api-token --secret-string 'NEW_TOKEN'`
3. `kubectl -n bt patch secret bt-config -p '{"stringData":{"HOSTINGER_API_TOKEN":"NEW_TOKEN"}}'`
4. Revoke the old token.

## AWS IAM user `sagar` (used by bt-ai and admin ops)

1. AWS console → IAM → Users → sagar → Security credentials → create new access key.
2. Update the k8s secret:
   `kubectl -n bt patch secret bt-config -p '{"stringData":{"AWS_ACCESS_KEY_ID":"...","AWS_SECRET_ACCESS_KEY":"..."}}'`
3. Restart bt-ai: `kubectl -n bt rollout restart deploy/bt-ai`
4. Wait for rollout complete, smoke-test via the mic in the chat widget.
5. Disable/delete the old key in IAM.

## Known leaked values (this chat session)

These were pasted in plaintext during the first build-out and must be rotated:
- CLAIM.MD AccountKey (rotate at CLAIM.MD)
- Hostinger API token (rotate at Hostinger)
