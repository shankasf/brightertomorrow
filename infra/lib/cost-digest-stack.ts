import { Stack, StackProps, Duration, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import * as path from "path";
import { LOG_RETENTION_DAYS } from "./constants";

export interface CostDigestStackProps extends StackProps {
  /** Recipient address — receives the daily summary. */
  recipientEmail: string;
  /** SES verified From identity (must be DKIM-verified). */
  fromEmail: string;
  /** SES verified-domain ARN that grants ses:SendEmail permission. */
  sesFromIdentityArn: string;
  /** Short label that appears in the subject line, e.g. "BT". */
  accountLabel?: string;
}

/**
 * CostDigestStack — daily Lambda that emails yesterday's AWS spend.
 *
 * One concern: pull Cost Explorer cost-by-service for the previous UTC day
 * and email a plain-text digest to the recipient. No PHI involved — billing
 * data only — so no CMK encryption on the log group is required.
 *
 * Schedule: 11:00 America/Los_Angeles every day. EventBridge Scheduler
 * adjusts for DST automatically (unlike legacy EventBridge Rules).
 */
export class CostDigestStack extends Stack {
  public readonly digestFn: lambda.Function;

  constructor(scope: Construct, id: string, props: CostDigestStackProps) {
    super(scope, id, props);

    const logGroup = new logs.LogGroup(this, "CostDigestLogs", {
      logGroupName: "/aws/lambda/bt-cost-digest",
      retention: LOG_RETENTION_DAYS as unknown as logs.RetentionDays,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.digestFn = new lambda.Function(this, "CostDigestFn", {
      functionName: "bt-cost-digest",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambdas/cost_digest")),
      timeout: Duration.seconds(30),
      memorySize: 256,
      logGroup,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        RECIPIENT_EMAIL: props.recipientEmail,
        FROM_EMAIL: props.fromEmail,
        ACCOUNT_LABEL: props.accountLabel ?? "BT",
        LOG_LEVEL: "INFO",
      },
    });

    // Cost Explorer — read-only, single API call. No resource-level ARNs.
    this.digestFn.addToRolePolicy(new iam.PolicyStatement({
      sid: "CostExplorerRead",
      effect: iam.Effect.ALLOW,
      actions: ["ce:GetCostAndUsage"],
      resources: ["*"],
    }));

    // SES — scoped to the verified From identity only.
    this.digestFn.addToRolePolicy(new iam.PolicyStatement({
      sid: "SesSendFromIdentity",
      effect: iam.Effect.ALLOW,
      actions: ["ses:SendEmail"],
      resources: [props.sesFromIdentityArn],
    }));

    // ── EventBridge Scheduler — 11:00 America/Los_Angeles ───────────────────
    // Scheduler (vs legacy Rules) supports IANA timezones, so DST is handled
    // automatically — the cron stays at 11:00 local clock-time year-round.
    const schedulerRole = new iam.Role(this, "SchedulerInvokeRole", {
      assumedBy: new iam.ServicePrincipal("scheduler.amazonaws.com"),
    });
    schedulerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["lambda:InvokeFunction"],
      resources: [this.digestFn.functionArn],
    }));

    new scheduler.CfnSchedule(this, "DailyDigestSchedule", {
      name: "bt-cost-digest-daily",
      description: "Trigger bt-cost-digest at 11:00 America/Los_Angeles daily",
      flexibleTimeWindow: { mode: "OFF" },
      scheduleExpression: "cron(0 11 * * ? *)",
      scheduleExpressionTimezone: "America/Los_Angeles",
      target: {
        arn: this.digestFn.functionArn,
        roleArn: schedulerRole.roleArn,
      },
      state: "ENABLED",
    });

    new CfnOutput(this, "CostDigestFunctionName", {
      exportName: "CostDigestFunctionName",
      value: this.digestFn.functionName,
    });
  }
}
