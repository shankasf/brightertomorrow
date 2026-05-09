import * as fs from "node:fs";
import * as path from "node:path";
import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as cf from "aws-cdk-lib/aws-cloudfront";
import * as origins from "aws-cdk-lib/aws-cloudfront-origins";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { ADMIN_DOMAIN, ROOT_DOMAIN } from "./constants";

export interface SpaStackProps extends StackProps {
  hostingerSecretArn: string;
  phiKeyArn: string;
}

export class SpaStack extends Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cf.Distribution;

  constructor(scope: Construct, id: string, props: SpaStackProps) {
    super(scope, id, props);

    void props.hostingerSecretArn;
    void props.phiKeyArn;

    this.bucket = new s3.Bucket(this, "AdminBucket", {
      bucketName: `bt-admin-spa-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const spaCertArn = this.node.tryGetContext("spaCertArn")
      || `arn:aws:acm:${this.region}:${this.account}:certificate/PLACEHOLDER-run-provision_cert.sh`;
    const cert = acm.Certificate.fromCertificateArn(this, "SpaCertImported", spaCertArn);

    // Next.js static export embeds a few executable inline <script> blocks per
    // page (hydration bootstrap, __next_f streaming chunks). admin-spa/scripts/
    // deploy.py recomputes their sha256 hashes after every build, writes them
    // to admin-spa/csp-hashes.json, and updates the live CloudFront policy in
    // the same run. CDK reads the same file so `cdk deploy` and the runtime
    // policy can never drift apart.
    //
    // Falls back to the legacy --context flag if the file isn't there yet.
    const hashesPath = path.join(__dirname, "..", "..", "admin-spa", "csp-hashes.json");
    let inlineScriptHashList: string[] = [];
    if (fs.existsSync(hashesPath)) {
      inlineScriptHashList = JSON.parse(fs.readFileSync(hashesPath, "utf-8"));
    } else {
      const ctx: string = this.node.tryGetContext("spaInlineScriptHashes") || "";
      inlineScriptHashList = ctx.split(",").map((s: string) => s.trim()).filter(Boolean);
    }
    const inlineScriptHashes = inlineScriptHashList.map((s) => `'${s}'`);
    const scriptSrc = ["script-src 'self'", ...inlineScriptHashes].join(" ");

    const responseHeaders = new cf.ResponseHeadersPolicy(this, "SecurityHeaders", {
      responseHeadersPolicyName: "bt-admin-security-headers",
      securityHeadersBehavior: {
        strictTransportSecurity: {
          accessControlMaxAge: Duration.days(730),
          includeSubdomains: true,
          preload: true,
          override: true,
        },
        contentTypeOptions: { override: true },
        referrerPolicy: {
          referrerPolicy: cf.HeadersReferrerPolicy.NO_REFERRER,
          override: true,
        },
        xssProtection: { protection: true, modeBlock: true, override: true },
        frameOptions: { frameOption: cf.HeadersFrameOption.DENY, override: true },
        contentSecurityPolicy: {
          contentSecurityPolicy: [
            "default-src 'self'",
            scriptSrc,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data:",
            `connect-src 'self' https://api.${ROOT_DOMAIN} https://cognito-idp.us-east-1.amazonaws.com`,
            "font-src 'self' data:",
            "frame-ancestors 'none'",
          ].join("; "),
          override: true,
        },
      },
    });

    this.distribution = new cf.Distribution(this, "Distribution", {
      defaultRootObject: "index.html",
      domainNames: [ADMIN_DOMAIN],
      certificate: cert,
      minimumProtocolVersion: cf.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cf.HttpVersion.HTTP2_AND_3,
      priceClass: cf.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cf.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cf.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        cachePolicy: cf.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: responseHeaders,
        compress: true,
      },
      errorResponses: [
        { httpStatus: 403, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.minutes(5) },
        { httpStatus: 404, responseHttpStatus: 200, responsePagePath: "/index.html", ttl: Duration.minutes(5) },
      ],
    });

    new CfnOutput(this, "BucketName", { value: this.bucket.bucketName });
    new CfnOutput(this, "DistributionId", { value: this.distribution.distributionId });
    new CfnOutput(this, "AdminUrl", { value: `https://${ADMIN_DOMAIN}` });
    new CfnOutput(this, "AdminAliasTarget", { value: this.distribution.distributionDomainName });
  }
}
