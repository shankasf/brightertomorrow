import { Stack, StackProps, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as logs from "aws-cdk-lib/aws-logs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as sm from "aws-cdk-lib/aws-secretsmanager";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import * as kms from "aws-cdk-lib/aws-kms";
import * as path from "path";
import { API_DOMAIN, DDB_GSI1, LOG_RETENTION_DAYS, ROOT_DOMAIN } from "./constants";

export interface ApiStackProps extends StackProps {
  tableName: string;
  tableArn: string;
  tableGsiArn: string;
  phiKeyArn: string;
  claimMdSecretArn: string;
  claimMdProviderSecretArn: string;
  openaiSecretArn: string;
  hostingerSecretArn: string;
  userPoolArn: string;
  userPoolId: string;
}

export class ApiStack extends Stack {
  public readonly api: apigw.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    // Import cross-stack resources by ARN to prevent CDK from mutating their
    // resource policies (which would create circular stack dependencies).
    const phiKey = kms.Key.fromKeyArn(this, "PhiKeyImported", props.phiKeyArn);
    const table = dynamodb.Table.fromTableAttributes(this, "TableImported", {
      tableArn: props.tableArn,
      globalIndexes: [DDB_GSI1],
      encryptionKey: phiKey,
    });
    const claimMdSecret = sm.Secret.fromSecretCompleteArn(this, "ClaimMdImported", props.claimMdSecretArn);
    const claimMdProviderSecret = sm.Secret.fromSecretCompleteArn(this, "ClaimMdProviderImported", props.claimMdProviderSecretArn);
    const openaiSecret = sm.Secret.fromSecretCompleteArn(this, "OpenAiImported", props.openaiSecretArn);
    const hostingerSecret = sm.Secret.fromSecretCompleteArn(this, "HostingerImported", props.hostingerSecretArn);
    const userPool = cognito.UserPool.fromUserPoolArn(this, "UserPoolImported", props.userPoolArn);

    const layer = new lambda.LayerVersion(this, "CommonLayer", {
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambdas/common_layer")),
      compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
      description: "bt_common — shared Python utilities",
    });

    const commonEnv = {
      LOG_LEVEL: "INFO",
      DDB_TABLE: props.tableName,
      DDB_GSI1: DDB_GSI1,
    };

    const mkFn = (name: string, dir: string, extraEnv: Record<string, string> = {}) =>
      new lambda.Function(this, name, {
        functionName: `bt-${dir.replace(/_/g, "-")}`,
        runtime: lambda.Runtime.PYTHON_3_12,
        handler: "handler.handler",
        code: lambda.Code.fromAsset(path.join(__dirname, "..", "lambdas", dir)),
        layers: [layer],
        timeout: Duration.seconds(25),
        memorySize: 512,
        logRetention: LOG_RETENTION_DAYS as unknown as logs.RetentionDays,
        tracing: lambda.Tracing.ACTIVE,
        environment: { ...commonEnv, ...extraEnv },
      });

    // Provider NPI + Tax ID live in Secrets Manager so they survive every
    // CDK redeploy (env vars get wiped). Populate one-time via:
    //   aws secretsmanager put-secret-value --secret-id bt/claim-md/provider \
    //     --secret-string '{"npi":"...","taxid":"..."}'
    const verifyInsurance = mkFn("VerifyInsurance", "verify_insurance", {
      CLAIM_MD_SECRET_ARN: claimMdSecret.secretArn,
      PROV_CREDS_SECRET_ARN: claimMdProviderSecret.secretArn,
    });
    const handleChat = mkFn("HandleChat", "handle_chat", {
      OPENAI_SECRET_ARN: openaiSecret.secretArn,
    });
    const getPatientData = mkFn("GetPatientData", "get_patient_data");
    const getDashboardMetrics = mkFn("GetDashboardMetrics", "get_dashboard_metrics");
    const listChatSessions = mkFn("ListChatSessions", "list_chat_sessions");

    table.grantReadWriteData(verifyInsurance);
    table.grantReadWriteData(handleChat);
    table.grantReadData(getPatientData);
    table.grantReadData(getDashboardMetrics);
    table.grantReadData(listChatSessions);

    claimMdSecret.grantRead(verifyInsurance);
    claimMdProviderSecret.grantRead(verifyInsurance);
    openaiSecret.grantRead(handleChat);

    // KMS grants against an imported key only mutate local role policies —
    // safe across stacks.
    phiKey.grantEncryptDecrypt(verifyInsurance);
    phiKey.grantEncryptDecrypt(handleChat);
    phiKey.grantDecrypt(getPatientData);
    phiKey.grantDecrypt(getDashboardMetrics);
    phiKey.grantDecrypt(listChatSessions);

    // Cert is provisioned out-of-band (scripts/provision_cert.sh), ARN
    // passed in via context. Synth uses a placeholder when absent so unrelated
    // deploys still work; deployment of BtApi without the real ARN will fail
    // at create-time with a meaningful message.
    const apiCertArn = this.node.tryGetContext("apiCertArn")
      || `arn:aws:acm:${this.region}:${this.account}:certificate/3c3b5f2a-cf1c-4a7a-8c3f-479fb1a4c2be`;
    const cert = acm.Certificate.fromCertificateArn(this, "ApiCertImported", apiCertArn);

    const accessLogs = new logs.LogGroup(this, "ApiAccessLogs", {
      // No explicit name — CFN generates a unique one so failed deploys
      // don't leave behind a name-colliding orphan.
      retention: LOG_RETENTION_DAYS as unknown as logs.RetentionDays,
      encryptionKey: phiKey,
      removalPolicy: require("aws-cdk-lib").RemovalPolicy.DESTROY,
    });

    this.api = new apigw.RestApi(this, "Api", {
      restApiName: "bt-api",
      description: "BrighterTomorrow therapy REST API",
      endpointTypes: [apigw.EndpointType.REGIONAL],
      domainName: {
        domainName: API_DOMAIN,
        certificate: cert,
        endpointType: apigw.EndpointType.REGIONAL,
        securityPolicy: apigw.SecurityPolicy.TLS_1_2,
      },
      deployOptions: {
        stageName: "prod",
        loggingLevel: apigw.MethodLoggingLevel.ERROR,
        dataTraceEnabled: false,
        metricsEnabled: true,
        tracingEnabled: true,
        accessLogDestination: new apigw.LogGroupLogDestination(accessLogs),
        accessLogFormat: apigw.AccessLogFormat.jsonWithStandardFields({
          caller: false,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: false,
        }),
        throttlingRateLimit: 50,
        throttlingBurstLimit: 100,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: [`https://admin.${ROOT_DOMAIN}`],
        allowMethods: apigw.Cors.ALL_METHODS,
        allowHeaders: ["Authorization", "Content-Type", "X-Amz-Date", "X-Api-Key", "X-Amz-Security-Token"],
        allowCredentials: true,
      },
      cloudWatchRole: true,
    });

    const authorizer = new apigw.CognitoUserPoolsAuthorizer(this, "CognitoAuth", {
      cognitoUserPools: [userPool],
      identitySource: "method.request.header.Authorization",
    });

    const withCognito = (method: "GET" | "POST", res: apigw.IResource, fn: lambda.IFunction) =>
      res.addMethod(method, new apigw.LambdaIntegration(fn), {
        authorizer,
        authorizationType: apigw.AuthorizationType.COGNITO,
      });

    const withIam = (method: "GET" | "POST", res: apigw.IResource, fn: lambda.IFunction) =>
      res.addMethod(method, new apigw.LambdaIntegration(fn), {
        authorizationType: apigw.AuthorizationType.IAM,
      });

    const internal = this.api.root.addResource("internal");
    withIam("POST", internal.addResource("insurance").addResource("verify"), verifyInsurance);
    withIam("POST", internal.addResource("chat").addResource("turn"), handleChat);

    const patients = this.api.root.addResource("patients");
    withCognito("GET", patients.addResource("{patient_id}"), getPatientData);

    const dashboard = this.api.root.addResource("dashboard");
    withCognito("GET", dashboard.addResource("metrics"), getDashboardMetrics);

    const chats = this.api.root.addResource("chats");
    withCognito("GET", chats, listChatSessions);

    new CfnOutput(this, "ApiUrl", { value: `https://${API_DOMAIN}` });
    new CfnOutput(this, "ApiGatewayUrl", { value: this.api.url });
    // DNS alias is written by scripts/set_dns.sh post-deploy (Hostinger
    // Cloudflare blocks Lambda IPs, so a CDK custom resource isn't reliable).
    new CfnOutput(this, "ApiAliasTarget", { value: this.api.domainName!.domainNameAliasDomainName });
  }
}
