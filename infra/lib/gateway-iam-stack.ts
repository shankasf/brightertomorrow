import { Stack, StackProps, RemovalPolicy, CfnOutput, SecretValue } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as kms from "aws-cdk-lib/aws-kms";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import { DDB_GSI1 } from "./constants";

export interface GatewayIamStackProps extends StackProps {
  phiKey: kms.IKey;
  tableArn: string;
}

/**
 * Off-AWS gateway (k3s on Hostinger VM) needs DynamoDB credentials.
 * IRSA isn't an option, so we provision an IAM user with a static
 * access key, scoped to PutItem/GetItem/Query/UpdateItem on bt-main
 * and its GSI1 index — nothing else.
 *
 * The access key lands in a CMK-encrypted Secrets Manager secret;
 * pull it into k8s with `aws secretsmanager get-secret-value` at
 * deploy time. Rotation = re-deploy this stack and re-sync the k8s secret.
 */
export class GatewayIamStack extends Stack {
  public readonly accessKeySecret: sm.Secret;

  constructor(scope: Construct, id: string, props: GatewayIamStackProps) {
    super(scope, id, props);

    const user = new iam.User(this, "GatewayUser", {
      userName: "bt-gateway-vm",
    });

    const tableGsiArn = `${props.tableArn}/index/${DDB_GSI1}`;

    user.addToPolicy(new iam.PolicyStatement({
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
    }));

    // CMK is needed to encrypt/decrypt items at rest. Without this the
    // gateway would get AccessDenied on every read/write.
    user.addToPolicy(new iam.PolicyStatement({
      sid: "CmkUseForDynamo",
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
          "kms:ViaService": `dynamodb.${this.region}.amazonaws.com`,
        },
      },
    }));

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
