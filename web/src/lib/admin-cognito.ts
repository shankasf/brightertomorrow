'use client';
import {
  CognitoUser,
  CognitoUserPool,
  CognitoUserSession,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';

const CONFIG = {
  region: process.env.NEXT_PUBLIC_AWS_REGION || 'us-east-1',
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || '',
  userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID || '',
};

let pool: CognitoUserPool | null = null;
function getPool(): CognitoUserPool {
  if (!pool) {
    if (!CONFIG.userPoolId || !CONFIG.userPoolClientId) {
      throw new Error('Cognito not configured (NEXT_PUBLIC_COGNITO_USER_POOL_ID / _CLIENT_ID missing)');
    }
    pool = new CognitoUserPool({
      UserPoolId: CONFIG.userPoolId,
      ClientId: CONFIG.userPoolClientId,
    });
  }
  return pool;
}

export type LoginResult =
  | { kind: 'success'; session: CognitoUserSession }
  | { kind: 'newPassword'; user: CognitoUser; requiredAttrs: string[] }
  | { kind: 'mfaSetup'; user: CognitoUser; secret: string; qr: string }
  | { kind: 'mfa'; user: CognitoUser };

export function startLogin(email: string, password: string): Promise<LoginResult> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getPool() });
    const details = new AuthenticationDetails({ Username: email, Password: password });
    user.authenticateUser(details, {
      onSuccess: (session) => resolve({ kind: 'success', session }),
      onFailure: reject,
      mfaRequired: () => resolve({ kind: 'mfa', user }),
      totpRequired: () => resolve({ kind: 'mfa', user }),
      newPasswordRequired: (userAttrs, required) => {
        // Strip Cognito read-only fields before confirming.
        delete userAttrs.email_verified;
        delete userAttrs.email;
        resolve({ kind: 'newPassword', user, requiredAttrs: required });
      },
      mfaSetup: () => {
        user.associateSoftwareToken({
          associateSecretCode: (secret) => {
            const qr = `otpauth://totp/BrighterTomorrowAdmin:${encodeURIComponent(email)}?secret=${secret}&issuer=BT%20Admin`;
            resolve({ kind: 'mfaSetup', user, secret, qr });
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
          associateSecretCode: () => reject(new Error('TOTP setup required — re-login')),
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
    }, 'SOFTWARE_TOKEN_MFA');
  });
}

export function verifyTotpSetup(user: CognitoUser, code: string): Promise<CognitoUserSession> {
  return new Promise((resolve, reject) => {
    user.verifySoftwareToken(code, 'Admin TOTP', {
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

export function cognitoLogout(): void {
  const user = getPool().getCurrentUser();
  user?.signOut();
}

export function isCognitoConfigured(): boolean {
  return !!(CONFIG.userPoolId && CONFIG.userPoolClientId);
}

export function requestPasswordReset(email: string): Promise<{ destination?: string }> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getPool() });
    user.forgotPassword({
      onSuccess: () => resolve({}),
      inputVerificationCode: (data: unknown) => {
        const dest = (data as { CodeDeliveryDetails?: { Destination?: string } })?.CodeDeliveryDetails?.Destination;
        resolve({ destination: dest });
      },
      onFailure: reject,
    });
  });
}

export function confirmPasswordReset(email: string, code: string, newPassword: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const user = new CognitoUser({ Username: email, Pool: getPool() });
    user.confirmPassword(code, newPassword, {
      onSuccess: () => resolve(),
      onFailure: reject,
    });
  });
}

/** Exchange a Cognito ID token for a gateway session token. */
export async function exchangeForGatewayToken(idToken: string): Promise<{ token: string; user: { id: number; email: string; role: string } }> {
  const res = await fetch('/admin/api/auth/exchange', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id_token: idToken }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`exchange failed (${res.status}): ${body}`);
  }
  return res.json();
}
