import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as path from "path";
import { DDB_TABLE, DDB_GSI1, DDB_JANE_EVENTS_TABLE, DDB_SOFT_HOLDS_TABLE, JANE_STAFF_IDS, LOG_RETENTION_DAYS } from "./constants";

export interface DataStackProps extends StackProps {
  phiKey: kms.IKey;
}

export class DataStack extends Stack {
  public readonly table: dynamodb.Table;
  public readonly janeEventsTable: dynamodb.Table;
  public readonly softHoldsTable: dynamodb.Table;
  public readonly janeIcalSyncFn: lambda.Function;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    // ── Existing main PHI table ──────────────────────────────────────────────
    this.table = new dynamodb.Table(this, "MainTable", {
      tableName: DDB_TABLE,
      partitionKey: { name: "PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "SK", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.phiKey,
      pointInTimeRecovery: true,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GSI1 — cross-entity queries by type + timestamp.
    // e.g. GSI1PK = "ENTITY#INSURANCE", GSI1SK = "2026-04-19T12:34:56Z"
    this.table.addGlobalSecondaryIndex({
      indexName: DDB_GSI1,
      partitionKey: { name: "GSI1PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI1SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── Jane iCal events table ───────────────────────────────────────────────
    // PHI present (description field). CMK encrypted, PITR, RETAIN.
    this.janeEventsTable = new dynamodb.Table(this, "JaneEventsTable", {
      tableName: DDB_JANE_EVENTS_TABLE,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.phiKey,
      pointInTimeRecovery: true,
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GSI: byStaffStart — range queries by therapist + time window
    this.janeEventsTable.addGlobalSecondaryIndex({
      indexName: "byStaffStart",
      partitionKey: { name: "staffId", type: dynamodb.AttributeType.NUMBER },
      sortKey: { name: "startISO", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ── Soft holds table ─────────────────────────────────────────────────────
    // appointmentDraft is JSON-string — encrypted at rest by the CMK.
    this.softHoldsTable = new dynamodb.Table(this, "SoftHoldsTable", {
      tableName: DDB_SOFT_HOLDS_TABLE,
      partitionKey: { name: "pk", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "sk", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.phiKey,
      pointInTimeRecovery: true,
      timeToLiveAttribute: "expiresAt",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // ── Jane iCal sync Lambda ────────────────────────────────────────────────
    const syncLogGroup = new logs.LogGroup(this, "JaneIcalSyncLogs", {
      logGroupName: "/aws/lambda/bt-jane-ical-sync",
      retention: logs.RetentionDays.ONE_MONTH,
      encryptionKey: props.phiKey,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.janeIcalSyncFn = new lambda.Function(this, "JaneIcalSyncFn", {
      functionName: "bt-jane-ical-sync",
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      code: lambda.Code.fromAsset(
        path.join(__dirname, "../lambdas/jane_ical_sync"),
      ),
      timeout: Duration.seconds(60),
      memorySize: 512,
      logGroup: syncLogGroup,
      tracing: lambda.Tracing.ACTIVE,
      environment: {
        JANE_EVENTS_TABLE: DDB_JANE_EVENTS_TABLE,
        STAFF_IDS: JANE_STAFF_IDS.join(","),
        LOG_LEVEL: "INFO",
      },
    });

    // DDB read/write on jane-events
    this.janeEventsTable.grantReadWriteData(this.janeIcalSyncFn);

    // Read all 6 iCal secrets via wildcard — one grant covers all staff IDs
    this.janeIcalSyncFn.addToRolePolicy(new iam.PolicyStatement({
      sid: "ReadJaneIcalSecrets",
      effect: iam.Effect.ALLOW,
      actions: ["secretsmanager:GetSecretValue"],
      resources: [
        `arn:aws:secretsmanager:${this.region}:${this.account}:secret:bt/jane-ical/*`,
      ],
    }));

    // KMS decrypt for DDB items and Secrets Manager
    this.janeIcalSyncFn.addToRolePolicy(new iam.PolicyStatement({
      sid: "CmkDecryptForSync",
      effect: iam.Effect.ALLOW,
      actions: [
        "kms:Decrypt",
        "kms:GenerateDataKey*",
        "kms:DescribeKey",
      ],
      resources: [props.phiKey.keyArn],
    }));

    // ── EventBridge cron: every 2 minutes ────────────────────────────────────
    const syncRule = new events.Rule(this, "JaneIcalSyncRule", {
      ruleName: "bt-jane-ical-sync-schedule",
      description: "Trigger bt-jane-ical-sync every 2 minutes to pull iCal data from Jane",
      schedule: events.Schedule.rate(Duration.minutes(2)),
      enabled: true,
    });
    syncRule.addTarget(new targets.LambdaFunction(this.janeIcalSyncFn, {
      retryAttempts: 2,
    }));

    // ── CloudFormation Outputs ───────────────────────────────────────────────
    new CfnOutput(this, "JaneEventsTableName", {
      exportName: "JaneEventsTableName",
      value: this.janeEventsTable.tableName,
    });
    new CfnOutput(this, "JaneEventsTableArn", {
      exportName: "JaneEventsTableArn",
      value: this.janeEventsTable.tableArn,
    });
    new CfnOutput(this, "SoftHoldsTableName", {
      exportName: "SoftHoldsTableName",
      value: this.softHoldsTable.tableName,
    });
    new CfnOutput(this, "SoftHoldsTableArn", {
      exportName: "SoftHoldsTableArn",
      value: this.softHoldsTable.tableArn,
    });
    new CfnOutput(this, "JaneIcalSyncFunctionName", {
      exportName: "JaneIcalSyncFunctionName",
      value: this.janeIcalSyncFn.functionName,
    });
    new CfnOutput(this, "JaneIcalSyncFunctionArn", {
      exportName: "JaneIcalSyncFunctionArn",
      value: this.janeIcalSyncFn.functionArn,
    });
  }
}
