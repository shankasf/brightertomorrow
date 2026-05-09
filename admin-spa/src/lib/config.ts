// Injected at build time via env. See package.json build script.
export const CONFIG = {
  apiUrl: process.env.NEXT_PUBLIC_API_URL || "https://api.brightertomorrowtherapy.cloud",
  region: process.env.NEXT_PUBLIC_AWS_REGION || "us-east-1",
  userPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || "",
  userPoolClientId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID || "",
};
