#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { SecurityStack } from "../lib/security-stack";
import { DataStack } from "../lib/data-stack";
import { SecretsStack } from "../lib/secrets-stack";
import { GatewayIamStack } from "../lib/gateway-iam-stack";
import { AuthStack } from "../lib/auth-stack";
import { ApiStack } from "../lib/api-stack";
import { ObservabilityStack } from "../lib/observability-stack";
import { NotificationsRetryStack } from "../lib/notifications-retry-stack";
import { CostDigestStack } from "../lib/cost-digest-stack";
import { AppLogsStack } from "../lib/app-logs-stack";
import { ACCOUNT, REGION, BOOTSTRAP_ADMIN_EMAIL, DDB_GSI1 } from "../lib/constants";

const app = new cdk.App();
const env = { account: ACCOUNT, region: REGION };

// Phase 1 — security, data, observability, secrets
const security = new SecurityStack(app, "BtSecurity", { env });

const data = new DataStack(app, "BtData", {
  env,
  phiKey: security.phiKey,
});
data.addDependency(security);

const secrets = new SecretsStack(app, "BtSecrets", {
  env,
  phiKey: security.phiKey,
});
secrets.addDependency(security);

const gatewayIam = new GatewayIamStack(app, "BtGatewayIam", {
  env,
  phiKey: security.phiKey,
  tableArn: data.table.tableArn,
  janeEventsTableArn: data.janeEventsTable.tableArn,
  softHoldsTableArn: data.softHoldsTable.tableArn,
  janeIcalSyncFnArn: data.janeIcalSyncFn.functionArn,
  // New intake-flow resources (LangGraph rewrite — May 2026)
  pendingRequestsTableArn: data.pendingRequestsTable.tableArn,
  adminQueueTableArn: data.adminQueueTable.tableArn,
  safetyQueueTableArn: data.safetyQueueTable.tableArn,
  notificationsOutboxTableArn: data.notificationsOutboxTable.tableArn,
  // bt-alerts SNS topic is owned by BtObservability. Import its ARN
  // directly to avoid a cross-stack resource-policy cycle.
  alertTopicArn: `arn:aws:sns:${REGION}:${ACCOUNT}:bt-alerts`,
});
gatewayIam.addDependency(security);
gatewayIam.addDependency(data);

new ObservabilityStack(app, "BtObservability", {
  env,
  phiKeyArn: security.phiKey.keyArn,
  alertEmail: BOOTSTRAP_ADMIN_EMAIL,
});

// Phase 2 — Cognito
const auth = new AuthStack(app, "BtAuth", { env });

// Phase 3 — Lambdas + API Gateway. Imports everything by ARN to avoid
// cross-stack resource-policy cycles.
new ApiStack(app, "BtApi", {
  env,
  tableName: data.table.tableName,
  tableArn: data.table.tableArn,
  tableGsiArn: `${data.table.tableArn}/index/${DDB_GSI1}`,
  phiKeyArn: security.phiKey.keyArn,
  claimMdSecretArn: secrets.claimMd.secretArn,
  claimMdProviderSecretArn: secrets.claimMdProvider.secretArn,
  openaiSecretArn: secrets.openai.secretArn,
  hostingerSecretArn: secrets.hostinger.secretArn,
  userPoolArn: auth.userPool.userPoolArn,
  userPoolId: auth.userPool.userPoolId,
});

// Phase 4 — Notifications retry worker.
// bt-phi-logs S3 bucket and the SES identity ARN are managed out-of-band
// (security team); pass their ARNs as CDK context keys:
//   cdk deploy BtNotificationsRetry \
//     --context phiLogsBucketArn=arn:aws:s3:::bt-phi-logs \
//     --context sesFromIdentityArn=arn:aws:ses:us-east-1:689517798275:identity/brightertomorrowtherapy.cloud
const phiLogsBucketArn = app.node.tryGetContext("phiLogsBucketArn")
  || `arn:aws:s3:::bt-phi-logs`;
const sesFromIdentityArn = app.node.tryGetContext("sesFromIdentityArn")
  || `arn:aws:ses:us-east-1:${ACCOUNT}:identity/mail.brightertomorrowtherapy.cloud`;

const notificationsRetry = new NotificationsRetryStack(app, "BtNotificationsRetry", {
  env,
  phiKeyArn: security.phiKey.keyArn,
  outboxTableArn: data.notificationsOutboxTable.tableArn,
  phiLogsBucketArn,
  sesFromIdentityArn,
});
notificationsRetry.addDependency(security);
notificationsRetry.addDependency(data);

// Phase 5 — Admin SPA: removed. admin.brightertomorrowtherapy.cloud now points
// directly at the Hostinger VM (k3s/Traefik), serving the full Next.js admin
// from web/src/app/admin/* with cert-manager/LE TLS. No CloudFront.

// Phase 6 — Operational log lake (frontend + gateway + bt-ai → S3 + Athena).
const appLogs = new AppLogsStack(app, "BtAppLogs", {
  env,
  phiKey: security.phiKey,
});
appLogs.addDependency(security);

// Phase 7 — Daily AWS cost digest email.
new CostDigestStack(app, "BtCostDigest", {
  env,
  recipientEmail: "sagar@callsphere.ai",
  fromEmail: "noreply@mail.callsphere.ai",
  sesFromIdentityArn: `arn:aws:ses:${REGION}:${ACCOUNT}:identity/mail.callsphere.ai`,
  accountLabel: "BT",
});

cdk.Tags.of(app).add("project", "brightertomorrowtherapy");
cdk.Tags.of(app).add("env", "prod");
cdk.Tags.of(app).add("hipaa", "true");

app.synth();
