import { Stack, StackProps, RemovalPolicy, Duration } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cloudtrail from "aws-cdk-lib/aws-cloudtrail";
import * as iam from "aws-cdk-lib/aws-iam";

export interface SecurityStackProps extends StackProps {}

export class SecurityStack extends Stack {
  public readonly phiKey: kms.Key;
  public readonly trailBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: SecurityStackProps) {
    super(scope, id, props);

    this.phiKey = new kms.Key(this, "PhiKey", {
      alias: "alias/bt-phi",
      description: "CMK for PHI at rest (DynamoDB, S3, CloudWatch Logs, Secrets Manager).",
      enableKeyRotation: true,
      rotationPeriod: Duration.days(365),
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // CloudTrail needs to use the CMK when the Trail is CMK-encrypted.
    this.phiKey.addToResourcePolicy(new iam.PolicyStatement({
      sid: "AllowCloudTrailUseOfKey",
      principals: [new iam.ServicePrincipal("cloudtrail.amazonaws.com")],
      actions: ["kms:GenerateDataKey*", "kms:DescribeKey", "kms:Decrypt"],
      resources: ["*"],
    }));
    // CloudWatch Logs in us-east-1 needs to encrypt/decrypt via the CMK when
    // log groups use the key.
    this.phiKey.addToResourcePolicy(new iam.PolicyStatement({
      sid: "AllowCloudWatchLogsUseOfKey",
      principals: [new iam.ServicePrincipal(`logs.${this.region}.amazonaws.com`)],
      actions: [
        "kms:Encrypt*", "kms:Decrypt*", "kms:ReEncrypt*",
        "kms:GenerateDataKey*", "kms:Describe*",
      ],
      resources: ["*"],
    }));

    this.trailBucket = new s3.Bucket(this, "TrailBucket", {
      bucketName: `bt-cloudtrail-${this.account}-${this.region}`,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.phiKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: true,
      objectLockEnabled: true,
      objectLockDefaultRetention: s3.ObjectLockRetention.compliance(Duration.days(365)),
      lifecycleRules: [
        {
          id: "transition-to-glacier",
          transitions: [
            { storageClass: s3.StorageClass.GLACIER, transitionAfter: Duration.days(90) },
          ],
        },
      ],
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Explicit CloudTrail service permissions on the bucket — CDK's Trail
    // construct does not auto-add these when the bucket is externally-owned
    // or has Object Lock enabled.
    this.trailBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: "AWSCloudTrailAclCheck",
      principals: [new iam.ServicePrincipal("cloudtrail.amazonaws.com")],
      actions: ["s3:GetBucketAcl"],
      resources: [this.trailBucket.bucketArn],
    }));
    this.trailBucket.addToResourcePolicy(new iam.PolicyStatement({
      sid: "AWSCloudTrailWrite",
      principals: [new iam.ServicePrincipal("cloudtrail.amazonaws.com")],
      actions: ["s3:PutObject"],
      resources: [`${this.trailBucket.bucketArn}/AWSLogs/${this.account}/*`],
      conditions: {
        StringEquals: { "s3:x-amz-acl": "bucket-owner-full-control" },
      },
    }));

    new cloudtrail.Trail(this, "Trail", {
      trailName: "bt-trail",
      bucket: this.trailBucket,
      encryptionKey: this.phiKey,
      sendToCloudWatchLogs: true,
      cloudWatchLogsRetention: 400 as never,
      includeGlobalServiceEvents: true,
      isMultiRegionTrail: true,
      enableFileValidation: true,
      managementEvents: cloudtrail.ReadWriteType.ALL,
    });
  }
}
