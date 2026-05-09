import { Stack, StackProps, RemovalPolicy, Duration, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import * as cognito from "aws-cdk-lib/aws-cognito";
import { BOOTSTRAP_ADMIN_EMAIL, ADMIN_DOMAIN } from "./constants";

export interface AuthStackProps extends StackProps {}

export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: AuthStackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, "AdminPool", {
      userPoolName: "bt-admin",
      signInAliases: { email: true, username: false },
      signInCaseSensitive: false,
      standardAttributes: {
        email: { required: true, mutable: false },
        givenName: { required: false, mutable: true },
        familyName: { required: false, mutable: true },
      },
      selfSignUpEnabled: false,
      mfa: cognito.Mfa.REQUIRED,
      mfaSecondFactor: { sms: false, otp: true },
      passwordPolicy: {
        minLength: 14,
        requireDigits: true,
        requireLowercase: true,
        requireUppercase: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      advancedSecurityMode: cognito.AdvancedSecurityMode.ENFORCED,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.userPoolClient = this.userPool.addClient("AdminSpaClient", {
      userPoolClientName: "bt-admin-spa",
      generateSecret: false,
      authFlows: {
        userSrp: true,
        custom: false,
        userPassword: false,
        adminUserPassword: false,
      },
      preventUserExistenceErrors: true,
      enableTokenRevocation: true,
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(30),
      oAuth: {
        flows: { authorizationCodeGrant: true, implicitCodeGrant: false },
        scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
        callbackUrls: [`https://${ADMIN_DOMAIN}/`, `https://${ADMIN_DOMAIN}/callback`],
        logoutUrls: [`https://${ADMIN_DOMAIN}/`],
      },
    });

    new cognito.CfnUserPoolUser(this, "BootstrapAdmin", {
      userPoolId: this.userPool.userPoolId,
      username: BOOTSTRAP_ADMIN_EMAIL,
      userAttributes: [
        { name: "email", value: BOOTSTRAP_ADMIN_EMAIL },
        { name: "email_verified", value: "true" },
      ],
      desiredDeliveryMediums: ["EMAIL"],
    });

    new CfnOutput(this, "UserPoolId", { value: this.userPool.userPoolId });
    new CfnOutput(this, "UserPoolClientId", { value: this.userPoolClient.userPoolClientId });
  }
}
