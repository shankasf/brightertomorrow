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
import { DDB_TABLE, DDB_GSI1, DDB_JANE_EVENTS_TABLE, DDB_SOFT_HOLDS_TABLE, DDB_NOTIFICATIONS_OUTBOX_TABLE, DDB_PENDING_REQUESTS_TABLE, DDB_ADMIN_QUEUE_TABLE, DDB_SAFETY_QUEUE_TABLE, JANE_STAFF_IDS, LOG_RETENTION_DAYS } from "./constants";

export interface DataStackProps extends StackProps {
  phiKey: kms.IKey;
}

export class DataStack extends Stack {
  public readonly table: dynamodb.Table;
  public readonly janeEventsTable: dynamodb.Table;
  public readonly softHoldsTable: dynamodb.Table;
  public readonly notificationsOutboxTable: dynamodb.Table;
  public readonly pendingRequestsTable: dynamodb.Table;
  public readonly adminQueueTable: dynamodb.Table;
  public readonly safetyQueueTable: dynamodb.Table;
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

    // byPhoneHash — look up a confirmed appointment by caller phone.
    // HIPAA: GSI key carries only the SHA-256 hash of the normalised 10-digit
    // phone number; raw phone lives in the encrypted item body, never in the key.
    // Sparse index: only items that have BOTH phoneHash AND appointmentTime are
    // indexed — exactly the booking/confirmed-intake records we want.
    this.table.addGlobalSecondaryIndex({
      indexName: "byPhoneHash",
      partitionKey: { name: "phoneHash", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "appointmentTime", type: dynamodb.AttributeType.STRING },
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

    // ── Notifications outbox table ───────────────────────────────────────────
    // Stores pending/retry/sent/dead delivery rows.
    // Action nodes write here atomically with the booking row.
    // HIPAA: message payloads are KMS-encrypted blobs — no plaintext PHI columns.
    // RETAIN: outbox rows are part of the audit trail; never auto-destroyed.
    this.notificationsOutboxTable = new dynamodb.Table(this, "NotificationsOutboxTable", {
      tableName: DDB_NOTIFICATIONS_OUTBOX_TABLE,
      partitionKey: { name: "notification_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.phiKey,
      pointInTimeRecovery: true,
      // TTL so sent rows auto-purge after 30 days without a manual delete job.
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // GSI1 — retry-scan: PK=status, SK=next_retry_at.
    // The retry Lambda queries this every minute to find due rows.
    // Projection ALL so the Lambda can read the full row without a second fetch.
    this.notificationsOutboxTable.addGlobalSecondaryIndex({
      indexName: "GSI1-retry-scan",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "next_retry_at", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI2 — dedupe: PK=dedupe_key.
    // KEYS_ONLY keeps it cheap; callers only need to know if a key exists.
    this.notificationsOutboxTable.addGlobalSecondaryIndex({
      indexName: "GSI2-dedupe",
      partitionKey: { name: "dedupe_key", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    require("aws-cdk-lib").Tags.of(this.notificationsOutboxTable).add("Project", "bt");
    require("aws-cdk-lib").Tags.of(this.notificationsOutboxTable).add("HIPAA", "true");
    require("aws-cdk-lib").Tags.of(this.notificationsOutboxTable).add("Owner", "bt-ai");

    // ── Pending intake requests table ─────────────────────────────────────────
    // Stores intake form submissions before they are fulfilled or cancelled.
    // GSIs support returning-patient lookup (phone/email hash) and the admin
    // dashboard pending queue.  TTL auto-purges fulfilled/cancelled rows after
    // 30 days.  HIPAA: hashed identifiers only in GSI keys; no raw PHI there.
    this.pendingRequestsTable = new dynamodb.Table(this, "PendingRequestsTable", {
      tableName: DDB_PENDING_REQUESTS_TABLE,
      partitionKey: { name: "request_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.phiKey,
      pointInTimeRecovery: true,
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Lookup returning patients by phone hash + created_at ordering.
    this.pendingRequestsTable.addGlobalSecondaryIndex({
      indexName: "byPhoneHash",
      partitionKey: { name: "phone_hash", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Lookup by email hash.
    this.pendingRequestsTable.addGlobalSecondaryIndex({
      indexName: "byEmailHash",
      partitionKey: { name: "email_hash", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Admin dashboard pending queue — filter/sort by status + created_at.
    this.pendingRequestsTable.addGlobalSecondaryIndex({
      indexName: "byStatus",
      partitionKey: { name: "status", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    require("aws-cdk-lib").Tags.of(this.pendingRequestsTable).add("Project", "bt");
    require("aws-cdk-lib").Tags.of(this.pendingRequestsTable).add("HIPAA", "true");
    require("aws-cdk-lib").Tags.of(this.pendingRequestsTable).add("Owner", "bt-ai");

    // ── Admin handoff queue table ─────────────────────────────────────────────
    // Stores routine clinical-intake handoff notifications (out_of_state,
    // roi_required, admin_with_note, admin_verification, admin_callback).
    // PK=queued_id (UUID), SK=created_at (RFC3339).
    // byStatus GSI lets the admin dashboard filter pending items by created_at.
    // TTL auto-purges rows after 90 days.  RETAIN: part of the audit trail.
    this.adminQueueTable = new dynamodb.Table(this, "AdminQueueTable", {
      tableName: DDB_ADMIN_QUEUE_TABLE,
      partitionKey: { name: "queued_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.phiKey,
      pointInTimeRecovery: true,
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // byStatus GSI — admin dashboard queries status="pending" ordered by created_at.
    this.adminQueueTable.addGlobalSecondaryIndex({
      indexName: "byStatus",
      partitionKey: { name: "GSI_status_PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI_status_SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    require("aws-cdk-lib").Tags.of(this.adminQueueTable).add("Project", "bt");
    require("aws-cdk-lib").Tags.of(this.adminQueueTable).add("HIPAA", "true");
    require("aws-cdk-lib").Tags.of(this.adminQueueTable).add("Owner", "bt-ai");

    // ── Safety queue table ────────────────────────────────────────────────────
    // Stores urgent safety escalations (abuse/crisis, Nevada NRS 432B reportable).
    // Separate table from admin queue so IAM policies, CloudWatch alarms, and
    // access logging can be scoped to safety items only.
    // Same key/GSI/TTL shape as admin queue for code reuse (AdminQueueStore handles both).
    this.safetyQueueTable = new dynamodb.Table(this, "SafetyQueueTable", {
      tableName: DDB_SAFETY_QUEUE_TABLE,
      partitionKey: { name: "queued_id", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "created_at", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: props.phiKey,
      pointInTimeRecovery: true,
      timeToLiveAttribute: "ttl",
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.safetyQueueTable.addGlobalSecondaryIndex({
      indexName: "byStatus",
      partitionKey: { name: "GSI_status_PK", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "GSI_status_SK", type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    require("aws-cdk-lib").Tags.of(this.safetyQueueTable).add("Project", "bt");
    require("aws-cdk-lib").Tags.of(this.safetyQueueTable).add("HIPAA", "true");
    require("aws-cdk-lib").Tags.of(this.safetyQueueTable).add("Owner", "bt-ai");

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

    // ── EventBridge cron: every 15 minutes ───────────────────────────────────
    const syncRule = new events.Rule(this, "JaneIcalSyncRule", {
      ruleName: "bt-jane-ical-sync-schedule",
      description: "Trigger bt-jane-ical-sync every 15 minutes to pull iCal data from Jane",
      schedule: events.Schedule.rate(Duration.minutes(15)),
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

    new CfnOutput(this, "NotificationsOutboxTableName", {
      exportName: "NotificationsOutboxTableName",
      value: this.notificationsOutboxTable.tableName,
    });
    new CfnOutput(this, "NotificationsOutboxTableArn", {
      exportName: "NotificationsOutboxTableArn",
      value: this.notificationsOutboxTable.tableArn,
    });
    new CfnOutput(this, "PendingRequestsTableName", {
      exportName: "PendingRequestsTableName",
      value: this.pendingRequestsTable.tableName,
    });
    new CfnOutput(this, "PendingRequestsTableArn", {
      exportName: "PendingRequestsTableArn",
      value: this.pendingRequestsTable.tableArn,
    });
    new CfnOutput(this, "AdminQueueTableName", {
      exportName: "AdminQueueTableName",
      value: this.adminQueueTable.tableName,
    });
    new CfnOutput(this, "AdminQueueTableArn", {
      exportName: "AdminQueueTableArn",
      value: this.adminQueueTable.tableArn,
    });
    new CfnOutput(this, "SafetyQueueTableName", {
      exportName: "SafetyQueueTableName",
      value: this.safetyQueueTable.tableName,
    });
    new CfnOutput(this, "SafetyQueueTableArn", {
      exportName: "SafetyQueueTableArn",
      value: this.safetyQueueTable.tableArn,
    });
  }
}
