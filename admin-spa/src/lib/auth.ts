"use client";
import {
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
  AuthenticationDetails,
} from "amazon-cognito-identity-js";
import { CONFIG } from "./config";

let pool: CognitoUserPool | null = null;
function getPool(): CognitoUserPool {
  if (!pool) {
    pool = new CognitoUserPool({
      UserPoolId: CONFIG.userPoolId,
      ClientId: CONFIG.userPoolClientId,
    });
  }
  return pool;
}

export type LoginResult =
  | { kind: "success"; session: CognitoUserSession }
  | { kind: "newPassword"; user: CognitoUser; requiredAttrs: string[] }
  | { kind: "mfaSetup"; user: CognitoUser; secret: string; qr: string }
  | { kind: "mfa"; user: CognitoUser };

export function startLogin(email: string, password: string): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getPool() });
    const details = new AuthenticationDetails({ Username: email, Password: password });
    user.authenticateUser(details, {
      onSuccess: (session) => resolve({ kind: "success", session }),
      onFailure: reject,
      mfaRequired: () => resolve({ kind: "mfa", user }),
      totpRequired: () => resolve({ kind: "mfa", user }),
      newPasswordRequired: (userAttrs, required) => {
        // Strip Cognito-read-only fields before confirming.
        delete userAttrs.email_verified;
        delete userAttrs.email;
        resolve({ kind: "newPassword", user, requiredAttrs: required });
      },
      mfaSetup: () => {
        user.associateSoftwareToken({
          associateSecretCode: (secret) => {
            const qr = `otpauth://totp/BrighterTomorrowAdmin:${email}?secret=${secret}&issuer=BT%20Admin`;
            resolve({ kind: "mfaSetup", user, secret, qr });
          },
          onFailure: reject,
        });
      },
    });
  });
}

export function completeNewPassword(user: CognitoUser, newPassword: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    user.completeNewPasswordChallenge(newPassword, {}, {
      onSuccess: resolve,
      onFailure: reject,
      mfaSetup: () => {
        user.associateSoftwareToken({
          associateSecretCode: () => reject(new Error("TOTP setup required — re-login")),
          onFailure: reject,
        });
      },
    });
  });
}

export function submitTotp(user: CognitoUser, code: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    user.sendMFACode(code, {
      onSuccess: resolve,
      onFailure: reject,
    }, "SOFTWARE_TOKEN_MFA");
  });
}

export function verifyTotpSetup(user: CognitoUser, code: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    user.verifySoftwareToken(code, "Admin TOTP", {
      onSuccess: () => {
        user.setUserMfaPreference(null, { PreferredMfa: true, Enabled: true }, (err) => {
          if (err) return reject(err);
          user.getSession((e: unknown, session: CognitoUserSession) => {
            if (e) return reject(e);
            resolve(session);
          });
        });
      },
      onFailure: reject,
    });
  });
}

export function currentSession(): Promise<CognitoUserSession | null> {
  return new Promise((resolve) => {
    const user = getPool().getCurrentUser();
    if (!user) return resolve(null);
    user.getSession((err: unknown, session: CognitoUserSession | null) => {
      if (err || !session?.isValid()) return resolve(null);
      resolve(session);
    });
  });
}

export function logout(): void {
  const user = getPool().getCurrentUser();
  user?.signOut();
}
