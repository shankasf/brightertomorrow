import { Stack, StackProps, RemovalPolicy, CfnOutput, SecretValue } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as sm from "aws-cdk-lib/aws-secretsmanager";

export interface GatewayIamStackProps extends StackProps {
  phiKey: kms.IKey;
  tableArn: string;
  janeEventsTableArn: string;
  softHoldsTableArn: string;
  janeIcalSyncFnArn: string;
  // New intake-flow tables and SNS topic (added when LangGraph rewrite
  // introduced returning-patient + admin/safety handoffs).
  pendingRequestsTableArn: string;
  adminQueueTableArn: string;
  safetyQueueTableArn: string;
  notificationsOutboxTableArn: string;
  alertTopicArn: string;
}

/**
 * Off-AWS gateway (k3s on Hostinger VM) needs DynamoDB credentials.
 * IRSA isn't an option, so we provision an IAM user with a static access
 * key, scoped narrowly to the resources the gateway actually touches.
 *
 * Permissions are attached via a customer-managed policy (not inline)
 * because the IAM-user inline limit of 2048 bytes was exceeded once the
 * 12-step intake flow added 4 new tables + SNS publish. Managed policies
 * allow 6144 bytes and up to 10 attachments per user.
 *
 * The access key lands in a CMK-encrypted Secrets Manager secret; pull
 * it into k8s with `aws secretsmanager get-secret-value` at deploy time.
 * Rotation = re-deploy this stack and re-sync the k8s secret.
 */
export class GatewayIamStack extends Stack {
  public readonly accessKeySecret: sm.Secret;

  constructor(scope: Construct, id: string, props: GatewayIamStackProps) {
    super(scope, id, props);

    const user = new iam.User(this, "GatewayUser", {
      userName: "bt-gateway-vm",
    });

    // Cover GSI1 and every other bt-main GSI (e.g. byPhoneHash for appointment
    // lookup). Mirrors the /index/* grants used for the other tables below so a
    // newly-added index doesn't silently break with AccessDeniedException.
    const tableGsiArn = `${props.tableArn}/index/*`;

    // All policy statements collected here, then attached via a single
    // ManagedPolicy below. SIDs are stable so policy diffs stay readable.
    const statements: iam.PolicyStatement[] = [
      // bt-main intake table — full CRUD + GSI1 query.
      new iam.PolicyStatement({
        sid: "DynamoDbIntakeAccess",
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
          "dynamodb:BatchWriteItem",
          "dynamodb:BatchGetItem",
          "dynamodb:DescribeTable",
        ],
        resources: [props.tableArn, tableGsiArn],
      }),

      // Jane iCal events + soft holds — availability + holds for booking.
      new iam.PolicyStatement({
        sid: "DynamoDbJaneEventsAndHolds",
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:DeleteItem",
          "dynamodb:DescribeTable",
        ],
        resources: [
          props.janeEventsTableArn,
          `${props.janeEventsTableArn}/index/*`,
          props.softHoldsTableArn,
        ],
      }),

      // Lambda invoke on jane_ical_sync — for on-demand availability refetch.
      new iam.PolicyStatement({
        sid: "InvokeJaneIcalSync",
        effect: iam.Effect.ALLOW,
        actions: ["lambda:InvokeFunction"],
        resources: [props.janeIcalSyncFnArn],
      }),

      // Intake-flow tables (LangGraph rewrite). Merged into one statement
      // by action-set to save inline-policy bytes; resources cover all 4
      // tables and their GSIs. Returning-patient lookup needs Query on
      // bt-pending-requests GSIs; admin/safety queues + outbox need writes.
      new iam.PolicyStatement({
        sid: "DynamoDbIntakeFlowTables",
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:Query",
          "dynamodb:UpdateItem",
          "dynamodb:DescribeTable",
        ],
        resources: [
          props.pendingRequestsTableArn,
          `${props.pendingRequestsTableArn}/index/*`,
          props.adminQueueTableArn,
          `${props.adminQueueTableArn}/index/*`,
          props.safetyQueueTableArn,
          `${props.safetyQueueTableArn}/index/*`,
          props.notificationsOutboxTableArn,
          `${props.notificationsOutboxTableArn}/index/*`,
        ],
      }),

      // SNS publish on bt-alerts — only safety_queue publishes (urgent
      // crisis / mandatory-report handoffs). Payloads are non-PHI.
      new iam.PolicyStatement({
        sid: "SnsPublishAlerts",
        effect: iam.Effect.ALLOW,
        actions: ["sns:Publish"],
        resources: [props.alertTopicArn],
      }),

      // CMK use for the gateway's encrypted services. Without this, every
      // DDB read/write fails with AccessDenied, and SNS publish on the
      // CMK-encrypted bt-alerts topic fails with KMSAccessDenied. The
      // ViaService condition list keeps the grant scoped to only the
      // services that legitimately consume the CMK on the gateway's behalf.
      new iam.PolicyStatement({
        sid: "CmkUseForGatewayServices",
        effect: iam.Effect.ALLOW,
        actions: [
          "kms:Encrypt",
          "kms:Decrypt",
          "kms:ReEncrypt*",
          "kms:GenerateDataKey*",
          "kms:DescribeKey",
        ],
        resources: [props.phiKey.keyArn],
        conditions: {
          StringEquals: {
            "kms:ViaService": [
              `dynamodb.${this.region}.amazonaws.com`,
              `sns.${this.region}.amazonaws.com`,
            ],
          },
        },
      }),

      // Invoke the notifications-retry Lambda synchronously right after the
      // gateway writes an outbox row — enables truly-immediate delivery without
      // waiting for the next EventBridge tick (≤1 min).
      new iam.PolicyStatement({
        sid: "InvokeNotificationsRetryLambda",
        effect: iam.Effect.ALLOW,
        actions: ["lambda:InvokeFunction"],
        resources: ["arn:aws:lambda:us-east-1:689517798275:function:bt-notifications-retry"],
      }),

      // Direct (non-ViaService) CMK encrypt for the notifications outbox.
      // phi.NotificationStore.EnqueueNotification calls kms:Encrypt itself to
      // wrap the patient-notification payload BEFORE the PutItem to
      // bt-notifications-outbox, so the encrypt is NOT performed "via" the
      // DynamoDB service and the ViaService-scoped grant above denies it.
      // Encrypt-only (no Decrypt): the gateway never reads payloads back —
      // the notifications-retry Lambda owns decryption.
      new iam.PolicyStatement({
        sid: "CmkEncryptForNotificationsOutbox",
        effect: iam.Effect.ALLOW,
        actions: ["kms:Encrypt", "kms:GenerateDataKey*", "kms:DescribeKey"],
        resources: [props.phiKey.keyArn],
      }),
    ];

    // Attach as a customer-managed policy — 6144 byte cap, well above the
    // 2048-byte inline-policy cap we hit when the intake-flow tables and
    // SNS publish statements were added.
    const policy = new iam.ManagedPolicy(this, "GatewayPolicy", {
      managedPolicyName: "bt-gateway-vm-policy",
      description: "Resources the bt-gateway pod accesses from the off-AWS k3s cluster.",
      statements,
    });
    user.addManagedPolicy(policy);

    const accessKey = new iam.AccessKey(this, "GatewayAccessKey", { user });

    this.accessKeySecret = new sm.Secret(this, "GatewayAccessKeySecret", {
      secretName: "bt/gateway/aws-credentials",
      description: "Access key for bt-gateway-vm IAM user — used by gateway pod to write PHI to DynamoDB bt-main.",
      encryptionKey: props.phiKey,
      removalPolicy: RemovalPolicy.RETAIN,
      secretObjectValue: {
        accessKeyId: SecretValue.unsafePlainText(accessKey.accessKeyId),
        secretAccessKey: accessKey.secretAccessKey,
      },
    });

    new CfnOutput(this, "GatewayUserName", { value: user.userName });
    new CfnOutput(this, "GatewayAccessKeySecretArn", { value: this.accessKeySecret.secretArn });
    new CfnOutput(this, "GatewayAccessKeySecretName", { value: this.accessKeySecret.secretName });
  }
}
