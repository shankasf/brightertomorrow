import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as kms from "aws-cdk-lib/aws-kms";
import * as glue from "aws-cdk-lib/aws-glue";
import * as athena from "aws-cdk-lib/aws-athena";
import * as iam from "aws-cdk-lib/aws-iam";
import {
  APP_LOGS_BUCKET,
  GLUE_LOG_DATABASE,
  GLUE_LOG_TABLE,
  ATHENA_LOG_WORKGROUP,
  ATHENA_LOG_QUERY_SCAN_LIMIT_BYTES,
} from "./constants";

export interface AppLogsStackProps extends StackProps {
  /** PHI CMK from SecurityStack — used to encrypt logs at rest. */
  phiKey: kms.IKey;
}

/**
 * AppLogsStack — operational log lake for frontend + gateway + bt-ai.
 *
 * Flow:  Vector DaemonSet (on Hostinger k3s) → S3 Parquet → Glue table → Athena.
 *
 * HIPAA controls baked in here (operational logs may contain PHI per the
 * solo-operator decision — patient IDs, tool args, etc.):
 *
 *  - §164.312(a)(2)(iv) Encryption at rest: SSE-KMS with alias/bt-phi.
 *  - §164.312(c)(1) Integrity:    S3 + KMS provide MAC; Parquet checksums.
 *  - §164.312(e)(1) Transmission: All puts/gets via HTTPS (AWS SDK default).
 *  - §164.312(a)(1) Access:       Block-Public-Access, scoped IAM, no wildcards.
 *  - §164.312(b)   Audit:         Admin Athena queries write admin_access_log
 *                                 rows in the gateway (see admin_logs.go).
 *  - §164.316(b)(2) Retention:    Lifecycle keeps objects 6 years (2200 days).
 */
export class AppLogsStack extends Stack {
  public readonly bucket: s3.Bucket;
  public readonly glueDatabaseName: string;
  public readonly glueTableName: string;
  public readonly athenaWorkgroup: athena.CfnWorkGroup;
  /** IAM user for Vector — write-only on the bucket. */
  public readonly vectorWriterUser: iam.User;
  /** Managed policy for the gateway/admin user to read logs via Athena. */
  public readonly readerPolicy: iam.ManagedPolicy;

  constructor(scope: Construct, id: string, props: AppLogsStackProps) {
    super(scope, id, props);

    // ── S3 bucket ────────────────────────────────────────────────────────────
    // Single bucket with prefix partitioning. Athena query results land in a
    // sibling prefix so we don't need a second bucket.
    this.bucket = new s3.Bucket(this, "AppLogsBucket", {
      bucketName: APP_LOGS_BUCKET,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: props.phiKey,
      bucketKeyEnabled: true,
      enforceSSL: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: "expire-logs-after-6yr",
          enabled: true,
          prefix: "logs/",
          transitions: [
            { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: Duration.days(30) },
            { storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL, transitionAfter: Duration.days(180) },
          ],
          expiration: Duration.days(2200), // ~6 years per §164.316(b)(2)(i)
        },
        {
          // Athena query results expire after 7 days — they can always be
          // regenerated and they sometimes contain PHI from the search.
          id: "expire-athena-results",
          enabled: true,
          prefix: "athena-results/",
          expiration: Duration.days(7),
        },
        {
          // Clean up multipart upload garbage to avoid unbounded cost.
          id: "abort-incomplete-mpu",
          enabled: true,
          abortIncompleteMultipartUploadAfter: Duration.days(2),
        },
      ],
    });

    // ── Glue database + table ────────────────────────────────────────────────
    this.glueDatabaseName = GLUE_LOG_DATABASE;
    this.glueTableName = GLUE_LOG_TABLE;

    const logDatabase = new glue.CfnDatabase(this, "LogDatabase", {
      catalogId: this.account,
      databaseInput: {
        name: GLUE_LOG_DATABASE,
        description: "Operational app logs for frontend + gateway + bt-ai (HIPAA — CMK encrypted).",
      },
    });

    // Schema: stable columns common across all services + a free-form attrs map.
    // Partitioned by service/yyyy/mm/dd/hh so per-service per-hour queries
    // scan only a few KB.
    const logTable = new glue.CfnTable(this, "LogTable", {
      catalogId: this.account,
      databaseName: GLUE_LOG_DATABASE,
      tableInput: {
        name: GLUE_LOG_TABLE,
        description: "Parquet-formatted operational logs. One row per source log line.",
        tableType: "EXTERNAL_TABLE",
        parameters: {
          classification: "json",
          "compressionType": "gzip",
          // Partition projection — avoids needing to run Glue Crawler.
          "projection.enabled": "true",
          "projection.service.type": "enum",
          "projection.service.values": "frontend,gateway,bt-ai",
          "projection.year.type": "integer",
          "projection.year.range": "2026,2032",
          "projection.month.type": "integer",
          "projection.month.range": "1,12",
          "projection.month.digits": "2",
          "projection.day.type": "integer",
          "projection.day.range": "1,31",
          "projection.day.digits": "2",
          "projection.hour.type": "integer",
          "projection.hour.range": "0,23",
          "projection.hour.digits": "2",
          "storage.location.template":
            `s3://${APP_LOGS_BUCKET}/logs/service=\${service}/year=\${year}/month=\${month}/day=\${day}/hour=\${hour}/`,
        },
        partitionKeys: [
          { name: "service", type: "string" },
          { name: "year", type: "int" },
          { name: "month", type: "int" },
          { name: "day", type: "int" },
          { name: "hour", type: "int" },
        ],
        storageDescriptor: {
          location: `s3://${APP_LOGS_BUCKET}/logs/`,
          inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
          outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
          serdeInfo: {
            // Hive JSON SerDe — reads gzipped JSONL files emitted by Vector.
            serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
            parameters: { "ignore.malformed.json": "true" },
          },
          columns: [
            { name: "log_id", type: "string", comment: "UUID v4 per line — primary dedup key" },
            { name: "ts", type: "timestamp", comment: "Event timestamp from source" },
            { name: "ingestion_ts", type: "timestamp", comment: "When Vector ingested the line" },
            { name: "level", type: "string", comment: "DEBUG|INFO|WARN|ERROR|CRITICAL" },
            { name: "message", type: "string", comment: "Free-form message body" },
            { name: "logger", type: "string", comment: "Source logger name" },
            { name: "session_id", type: "string", comment: "Chat/voice session id (when applicable)" },
            { name: "patient_id", type: "string", comment: "PHI: patient id (when applicable)" },
            { name: "trace_id", type: "string", comment: "Cross-service correlation id" },
            { name: "request_id", type: "string", comment: "HTTP request id (chi RequestID)" },
            { name: "pod", type: "string", comment: "k8s pod name" },
            { name: "container", type: "string", comment: "k8s container name" },
            { name: "host", type: "string", comment: "k8s node name" },
            { name: "attrs", type: "map<string,string>", comment: "Free-form key/value fields" },
            { name: "raw", type: "string", comment: "Original line if not JSON" },
          ],
        },
      },
    });

    // Glue table depends on the database — CFN doesn't infer this from the
    // databaseName string property, so wire it explicitly to avoid the race
    // where the table tries to create before the database exists.
    logTable.addDependency(logDatabase);

    // ── Athena workgroup ─────────────────────────────────────────────────────
    this.athenaWorkgroup = new athena.CfnWorkGroup(this, "LogSearchWorkgroup", {
      name: ATHENA_LOG_WORKGROUP,
      description: "App-log search — per-query scan capped to prevent runaway costs.",
      state: "ENABLED",
      recursiveDeleteOption: true,
      workGroupConfiguration: {
        // Hard cap. Anything bigger and the query is rejected with an error
        // the admin UI can show.
        bytesScannedCutoffPerQuery: ATHENA_LOG_QUERY_SCAN_LIMIT_BYTES,
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        resultConfiguration: {
          outputLocation: `s3://${APP_LOGS_BUCKET}/athena-results/`,
          encryptionConfiguration: {
            encryptionOption: "SSE_KMS",
            kmsKey: props.phiKey.keyArn,
          },
        },
        engineVersion: { selectedEngineVersion: "Athena engine version 3" },
      },
    });

    // ── Vector writer IAM user (least privilege: PutObject + KMS encrypt) ───
    this.vectorWriterUser = new iam.User(this, "VectorWriterUser", {
      userName: "bt-vector-logs-writer",
    });

    this.vectorWriterUser.addToPolicy(new iam.PolicyStatement({
      sid: "PutLogsToBucket",
      effect: iam.Effect.ALLOW,
      actions: ["s3:PutObject"],
      resources: [`${this.bucket.bucketArn}/logs/*`],
    }));

    this.vectorWriterUser.addToPolicy(new iam.PolicyStatement({
      sid: "EncryptWithPhiKey",
      effect: iam.Effect.ALLOW,
      actions: ["kms:GenerateDataKey", "kms:Encrypt", "kms:DescribeKey"],
      resources: [props.phiKey.keyArn],
    }));

    // Optional: Vector also reads bucket metadata when starting up (rare).
    this.vectorWriterUser.addToPolicy(new iam.PolicyStatement({
      sid: "BucketMetadata",
      effect: iam.Effect.ALLOW,
      actions: ["s3:ListBucket", "s3:GetBucketLocation"],
      resources: [this.bucket.bucketArn],
    }));

    // ── Reader policy for the gateway (admin UI Athena queries) ──────────────
    // We don't create a new user here — the existing bt-gateway-vm user (whose
    // keys are mounted as BT_GATEWAY_AWS_*) attaches this policy out-of-band.
    // Doing it as a ManagedPolicy keeps the attachment idempotent.
    this.readerPolicy = new iam.ManagedPolicy(this, "LogReaderPolicy", {
      managedPolicyName: "bt-app-logs-reader",
      description: "Read-only log search via Athena. Attach to gateway IAM user.",
      statements: [
        new iam.PolicyStatement({
          sid: "AthenaQuery",
          effect: iam.Effect.ALLOW,
          actions: [
            "athena:StartQueryExecution",
            "athena:GetQueryExecution",
            "athena:GetQueryResults",
            "athena:StopQueryExecution",
            "athena:GetWorkGroup",
          ],
          resources: [
            `arn:aws:athena:${this.region}:${this.account}:workgroup/${ATHENA_LOG_WORKGROUP}`,
          ],
        }),
        new iam.PolicyStatement({
          sid: "GlueCatalogRead",
          effect: iam.Effect.ALLOW,
          actions: [
            "glue:GetDatabase",
            "glue:GetTable",
            "glue:GetTables",
            "glue:GetPartition",
            "glue:GetPartitions",
          ],
          resources: [
            `arn:aws:glue:${this.region}:${this.account}:catalog`,
            `arn:aws:glue:${this.region}:${this.account}:database/${GLUE_LOG_DATABASE}`,
            `arn:aws:glue:${this.region}:${this.account}:table/${GLUE_LOG_DATABASE}/${GLUE_LOG_TABLE}`,
          ],
        }),
        new iam.PolicyStatement({
          sid: "S3ReadLogsAndResults",
          effect: iam.Effect.ALLOW,
          actions: ["s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
          resources: [this.bucket.bucketArn, `${this.bucket.bucketArn}/*`],
        }),
        new iam.PolicyStatement({
          sid: "S3WriteAthenaResults",
          effect: iam.Effect.ALLOW,
          actions: ["s3:PutObject", "s3:AbortMultipartUpload"],
          resources: [`${this.bucket.bucketArn}/athena-results/*`],
        }),
        new iam.PolicyStatement({
          sid: "KmsDecryptForResults",
          effect: iam.Effect.ALLOW,
          actions: ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
          resources: [props.phiKey.keyArn],
        }),
      ],
    });

    // ── Outputs ──────────────────────────────────────────────────────────────
    new CfnOutput(this, "AppLogsBucketName", {
      exportName: "AppLogsBucketName",
      value: this.bucket.bucketName,
    });
    new CfnOutput(this, "AppLogsBucketArn", {
      exportName: "AppLogsBucketArn",
      value: this.bucket.bucketArn,
    });
    new CfnOutput(this, "LogGlueDatabase", {
      exportName: "LogGlueDatabase",
      value: GLUE_LOG_DATABASE,
    });
    new CfnOutput(this, "LogGlueTable", {
      exportName: "LogGlueTable",
      value: GLUE_LOG_TABLE,
    });
    new CfnOutput(this, "LogAthenaWorkgroup", {
      exportName: "LogAthenaWorkgroup",
      value: ATHENA_LOG_WORKGROUP,
    });
    new CfnOutput(this, "VectorWriterUserName", {
      exportName: "VectorWriterUserName",
      value: this.vectorWriterUser.userName,
    });
    new CfnOutput(this, "LogReaderPolicyArn", {
      exportName: "LogReaderPolicyArn",
      value: this.readerPolicy.managedPolicyArn,
    });
  }
}
