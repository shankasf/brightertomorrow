import { Stack, StackProps, RemovalPolicy, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as kms from "aws-cdk-lib/aws-kms";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import { SECRET_NAMES, JANE_STAFF_IDS } from "./constants";

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
  public readonly janeIcalSecrets: Record<number, sm.Secret>;

  constructor(scope: Construct, id: string, props: SecretsStackProps) {
    super(scope, id, props);

    const shell = (name: string, description: string, secretStringTemplate?: string) =>
      new sm.Secret(this, name.replace(/[^A-Za-z0-9]/g, ""), {
        secretName: name,
        description,
        encryptionKey: props.phiKey,
        // Provide a placeholder JSON structure so the secret has the right
        // shape immediately after deploy. The user replaces values via:
        //   aws secretsmanager put-secret-value --secret-id <name> \
        //     --secret-string '{"apptsUrl":"https://...","shiftsUrl":"https://..."}'
        secretStringValue: secretStringTemplate
          ? (require("aws-cdk-lib").SecretValue.unsafePlainText(secretStringTemplate) as any)
          : undefined,
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

    // ── Jane iCal secrets — one per therapist ────────────────────────────────
    // Values are PLACEHOLDERS. Populate post-deploy:
    //   aws secretsmanager put-secret-value \
    //     --secret-id bt/jane-ical/staff-<id> \
    //     --secret-string '{"apptsUrl":"<real>","shiftsUrl":"<real>"}'
    // Real URLs are in jane_calendar_sync.txt — never committed to source.
    const PLACEHOLDER_ICAL = JSON.stringify({
      apptsUrl: "PLACEHOLDER_REPLACE_VIA_CLI",
      shiftsUrl: "PLACEHOLDER_REPLACE_VIA_CLI",
    });

    this.janeIcalSecrets = {};
    for (const staffId of JANE_STAFF_IDS) {
      const secretName = `bt/jane-ical/staff-${staffId}`;
      // CDK logical ID must be alphanumeric
      const logicalId = `JaneIcalStaff${staffId}`;

      const secret = new sm.Secret(this, logicalId, {
        secretName,
        description: `Jane iCal URLs for therapist staff-${staffId} — apptsUrl + shiftsUrl`,
        encryptionKey: props.phiKey,
        secretStringValue: require("aws-cdk-lib").SecretValue.unsafePlainText(PLACEHOLDER_ICAL),
        removalPolicy: RemovalPolicy.RETAIN,
      });

      // HIPAA compliance tag
      require("aws-cdk-lib").Tags.of(secret).add("Compliance", "HIPAA");

      this.janeIcalSecrets[staffId] = secret;

      // Output ARN so other teams / deploy scripts can reference it without
      // hard-coding the Secrets Manager ARN suffix.
      const capitalId = `Staff${staffId}`;
      new CfnOutput(this, `JaneIcalSecret${capitalId}Arn`, {
        exportName: `JaneIcalSecret${capitalId}Arn`,
        value: secret.secretArn,
        description: `ARN of Jane iCal secret for staff ${staffId}`,
      });
    }
  }
}
