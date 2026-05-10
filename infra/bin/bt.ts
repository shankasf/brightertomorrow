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

// Phase 4 — Admin SPA: removed. admin.brightertomorrowtherapy.cloud now points
// directly at the Hostinger VM (k3s/Traefik), serving the full Next.js admin
// from web/src/app/admin/* with cert-manager/LE TLS. No CloudFront.

cdk.Tags.of(app).add("project", "brightertomorrowtherapy");
cdk.Tags.of(app).add("env", "prod");
cdk.Tags.of(app).add("hipaa", "true");

app.synth();
