import {
  changePasswordCognito,
  poolOfToken,
  type CognitoPoolType,
} from "@/lib/auth/cognito";
import { getStoredToken } from "@/lib/auth/token";

/** Which Cognito pool minted the stored access token, from its `iss` claim. */
function storedTokenPool(): CognitoPoolType | null {
  return poolOfToken(getStoredToken());
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
