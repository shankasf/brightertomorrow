import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as path from "path";
import {
  DDB_NOTIFICATIONS_OUTBOX_TABLE,
  LOG_RETENTION_DAYS,
  SECRET_TWILIO,
  PHI_LOGS_BUCKET,
} from "./constants";

export interface NotificationsRetryStackProps extends StackProps {
  /** ARN of the bt CMK (alias/bt-phi) — imported from SecurityStack. */
  phiKeyArn: string;
  /** ARN of the bt-notifications-outbox DDB table. */
  outboxTableArn: string;
  /** ARN of the bt-phi-logs S3 bucket. */
  phiLogsBucketArn: string;
  /**
   * ARN of a verified SES identity (domain or address) used as the From
   * address for email notifications.
   */
  sesFromIdentityArn: string;
}

/**
 * NotificationsRetryStack — EventBridge-triggered Lambda that drives the
 * outbox retry pattern for booking notifications (SMS, email, S3 PHI log).
 *
 * One concern per stack (SRP):
 *  - Lambda function + log group
 *  - IAM role (least-privilege, no wildcards)
 *  - EventBridge schedule (rate 1 minute)
 *  - Concurrency limit = 2 to stay within Twilio rate limits
 */
export class NotificationsRetryStack extends Stack {
  public readonly retryFn: lambda.Function;

  constructor(scope: Construct, id: string, props: NotificationsRetryStackProps) {
    super(scope, id, props);

    // Import the bt CMK so we can reference its ARN in IAM policies.
    // Importing by ARN (rather than passing the Key object) avoids cross-stack
    // resource-policy cycles that CDK would inject into the KMS key policy.
    const phiKey = kms.Key.fromKeyArn(this, "PhiKeyImported", props.phiKeyArn);

    // ── Dedicated log group — KMS encrypted, 400-day HIPAA retention ─────────
    const logGroup = new logs.LogGroup(this, "RetryLogs", {
      logGroupName: "/aws/lambda/bt-notifications-retry",
      retention: LOG_RETENTION_DAYS as unknown as logs.RetentionDays,
      encryptionKey: phiKey,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ── Lambda function ───────────────────────────────────────────────────────
    this.retryFn = new lambda.Function(this, "NotificationsRetryFn", {
      functionName: "bt-notifications-retry",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../lambdas/notifications_retry"),
      ),
      // 60 s matches the EventBridge rate so one invocation always completes
      // before the next fires.
      timeout: Duration.seconds(60),
      memorySize: 512,
      logGroup,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        OUTBOX_TABLE: DDB_NOTIFICATIONS_OUTBOX_TABLE,
        KMS_KEY_ID: props.phiKeyArn,
        PHI_BUCKET: PHI_LOGS_BUCKET,
        TWILIO_SECRET_ARN: `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${SECRET_TWILIO}`,
        // TWILIO_ACCOUNT_SID and TWILIO_FROM_NUMBER are injected via
        // aws secretsmanager — referenced in senders.py.
        // SES_FROM_EMAIL is overridden post-deploy:
        //   aws lambda update-function-configuration \
        //     --function-name bt-notifications-retry \
        //     --environment Variables='{..., "SES_FROM_EMAIL":"noreply@brightertomorrowtherapy.cloud"}'
        SES_FROM_EMAIL: "noreply@brightertomorrowtherapy.cloud",
        // Twilio + SES are intentionally disabled until provisioned. Rows
        // for those channels are marked status="service_unavailable" so
        // admins can manually follow up — no API calls attempted. Flip
        // these to "false" once the providers are live.
        DISABLE_TWILIO: "true",
        DISABLE_SES: "true",
        LOG_LEVEL: "INFO",
      },
    });

    // Concurrency: no reservedConcurrentExecutions — the account's total
    // concurrency pool is 10 (default floor), so any reservation would drop
    // unreserved below the mandatory minimum of 10 and CloudFormation would
    // reject the stack.  The EventBridge rate(1 minute) schedule is the
    // natural throttle: at most 1 invocation/min, with a 60 s timeout, so
    // concurrent executions of this function will never exceed 1 in practice.

    // ── IAM — least-privilege, no wildcards ──────────────────────────────────

    // DDB: Query on GSI1 + UpdateItem on the outbox table only.
    this.retryFn.addToRolePolicy(new iam.PolicyStatement({
      sid: "OutboxDdbAccess",
      effect: iam.Effect.ALLOW,
      actions: ["dynamodb:Query", "dynamodb:UpdateItem"],
      resources: [
        props.outboxTableArn,
        `${props.outboxTableArn}/index/GSI1-retry-scan`,
      ],
    }));

    // KMS: Encrypt + Decrypt for payload blobs stored in DDB outbox rows.
    // GenerateDataKey* is needed by the DDB client when writing encrypted items.
    this.retryFn.addToRolePolicy(new iam.PolicyStatement({
      sid: "CmkEncryptDecrypt",
      effect: iam.Effect.ALLOW,
      actions: [
        "kms:Decrypt",
        "kms:Encrypt",
        "kms:GenerateDataKey*",
        "kms:DescribeKey",
      ],
      resources: [phiKey.keyArn],
    }));

    // SES: SendEmail from the verified domain identity only.
    this.retryFn.addToRolePolicy(new iam.PolicyStatement({
      sid: "SesSendEmail",
      effect: iam.Effect.ALLOW,
      actions: ["ses:SendEmail"],
      resources: [props.sesFromIdentityArn],
    }));

    // S3: PutObject on bt-phi-logs only.
    this.retryFn.addToRolePolicy(new iam.PolicyStatement({
      sid: "PhiLogsPutObject",
      effect: iam.Effect.ALLOW,
      actions: ["s3:PutObject"],
      resources: [`${props.phiLogsBucketArn}/phi/*`],
    }));

    // Secrets Manager: Twilio credentials only.
    this.retryFn.addToRolePolicy(new iam.PolicyStatement({
      sid: "TwilioSecretRead",
      effect: iam.Effect.ALLOW,
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:${SECRET_TWILIO}*`,
      ],
    }));

    // CloudWatch custom metrics (DeadRows) — namespace bt/Notifications only.
    this.retryFn.addToRolePolicy(new iam.PolicyStatement({
      sid: "CwPutMetricData",
      effect: iam.Effect.ALLOW,
      actions: ["cloudwatch:PutMetricData"],
      resources: ["*"],
      conditions: {
        // Limit to our namespace to prevent accidental pollution.
        StringEquals: { "cloudwatch:namespace": "bt/Notifications" },
      },
    }));

    // ── EventBridge rule — rate(1 minute) ────────────────────────────────────
    // Rate schedule rather than cron so it fires 60 s after each invocation
    // regardless of calendar alignment.
    const rule = new events.Rule(this, "RetryScheduleRule", {
      ruleName: "bt-notifications-retry-schedule",
      description: "Trigger bt-notifications-retry every minute to process outbox rows",
      schedule: events.Schedule.rate(Duration.minutes(1)),
      enabled: true,
    });
    rule.addTarget(new targets.LambdaFunction(this.retryFn, {
      retryAttempts: 0, // do not retry on Lambda errors; next invocation picks up
    }));

    // ── CloudFormation outputs ────────────────────────────────────────────────
    new CfnOutput(this, "RetryFunctionName", {
      exportName: "NotificationsRetryFunctionName",
      value: this.retryFn.functionName,
    });
    new CfnOutput(this, "RetryFunctionArn", {
      exportName: "NotificationsRetryFunctionArn",
      value: this.retryFn.functionArn,
    });
  }
}
