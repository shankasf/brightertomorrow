import { Stack, StackProps, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import { SECRET_NAMES } from "./constants";

export interface SecretsStackProps extends StackProps {
  phiKey: kms.IKey;
}

/**
 * Declares secret shells; values are written out-of-band via
 * `aws secretsmanager put-secret-value` so plaintext never lives in a
 * CloudFormation template.
 */
export class SecretsStack extends Stack {
  public readonly claimMd: sm.Secret;
  public readonly claimMdProvider: sm.Secret;
  public readonly openai: sm.Secret;
  public readonly hostinger: sm.Secret;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
    super(scope, id, props);

    const shell = (name: string, description: string) =>
      new sm.Secret(this, name.replace(/[^A-Za-z0-9]/g, ""), {
        secretName: name,
        description,
        encryptionKey: props.phiKey,
        removalPolicy: RemovalPolicy.RETAIN,
      });

    this.claimMd = shell(SECRET_NAMES.CLAIM_MD, "CLAIM.MD eligibility API AccountKey");
    this.claimMdProvider = shell(
      SECRET_NAMES.CLAIM_MD_PROVIDER,
      'CLAIM.MD provider credentials JSON: {"npi":"...","taxid":"..."}',
    );
    this.openai = shell(SECRET_NAMES.OPENAI, "OpenAI API key (BAA-covered, ZDR)");
    this.hostinger = shell(SECRET_NAMES.HOSTINGER, "Hostinger DNS API token");

    new CfnOutput(this, "ClaimMdArn", { value: this.claimMd.secretArn });
    new CfnOutput(this, "ClaimMdProviderArn", { value: this.claimMdProvider.secretArn });
    new CfnOutput(this, "OpenAiArn", { value: this.openai.secretArn });
    new CfnOutput(this, "HostingerArn", { value: this.hostinger.secretArn });
  }
}
