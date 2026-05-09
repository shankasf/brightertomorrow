import { Duration, CustomResource } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import * as kms from "aws-cdk-lib/aws-kms";
import { Provider } from "aws-cdk-lib/custom-resources";
import * as path from "path";

export interface HostingerRecordProps {
  domain: string;
  name: string;
  type: "A" | "CNAME" | "TXT";
  content: string;
  ttl?: number;
  hostingerSecret: sm.ISecret;
  phiKey?: kms.IKey;
}

/**
 * CDK custom resource that upserts a single DNS record at Hostinger via their
 * public API. Token pulled from Secrets Manager at deploy time.
 */
export class HostingerRecord extends Construct {
  constructor(scope: Construct, id: string, props: HostingerRecordProps) {
    super(scope, id);

    const fn = new lambda.Function(this, "Fn", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.on_event",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambdas/hostinger_dns_cr")),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        HOSTINGER_SECRET_ARN: props.hostingerSecret.secretArn,
      },
    });
    props.hostingerSecret.grantRead(fn);
    // The secret is encrypted with the PHI CMK; grant the Lambda decrypt.
    if (props.phiKey) {
      props.phiKey.grantDecrypt(fn);
    }

    const provider = new Provider(this, "Provider", { onEventHandler: fn });

    new CustomResource(this, "Resource", {
      serviceToken: provider.serviceToken,
      properties: {
        Domain: props.domain,
        Name: props.name,
        Type: props.type,
        Content: props.content,
        TTL: props.ttl ?? 300,
      },
    });
  }
}
