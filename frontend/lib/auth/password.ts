import {
  COGNITO_CONFIG,
  changePasswordCognito,
  type CognitoPoolType,
} from "@/lib/auth/cognito";
import { getStoredToken } from "@/lib/auth/token";

/** Which Cognito pool minted the stored access token, from its `iss` claim. */
function storedTokenPool(): CognitoPoolType | null {
  const token = getStoredToken();
  if (!token) return null;
  try {
    const payload = token.split(".")[1];
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    const issuer: unknown = claims?.iss;
    if (typeof issuer !== "string") return null;
    if (issuer.endsWith(`/${COGNITO_CONFIG.candidatePoolId}`)) return "CANDIDATE";
    if (issuer.endsWith(`/${COGNITO_CONFIG.businessPoolId}`)) return "BUSINESS";
  } catch {
    /* fall through */
  }
  return null;
}

/** Pool of the signed-in user; defaults to business for any non-candidate portal. */
export function currentPasswordPool(portalPool: CognitoPoolType): CognitoPoolType {
  return storedTokenPool() ?? portalPool;
}

export async function changeMyPassword(
  oldPassword: string,
  newPassword: string,
  portalPool: CognitoPoolType,
): Promise<void> {
  await changePasswordCognito(oldPassword, newPassword, currentPasswordPool(portalPool));
}
