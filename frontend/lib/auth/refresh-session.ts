import { fetchAuthSession } from "aws-amplify/auth";

import {
  COGNITO_CONFIG,
  configureAmplify,
  type CognitoPoolType,
} from "@/lib/auth/cognito";
import { getStoredToken, setStoredToken } from "@/lib/auth/token";
import { getTokenExpiration } from "@/lib/auth/token-expiration";

/*
 * Cognito access tokens last about an hour or less; the refresh token behind
 * them lasts 30 days. Amplify keeps the refresh token in browser storage and
 * trades it for a new access token, so the user is only signed out when that
 * refresh token itself is gone or refused -- not when the access token ages.
 */

/** Refresh this long before the access token actually expires. */
export const REFRESH_LEEWAY_MS = 60_000;

export type RefreshResult =
  /** A usable access token is stored (it may have just been renewed). */
  | { status: "OK"; token: string }
  /** Cognito refused: the refresh token is expired or revoked. Sign in again. */
  | { status: "EXPIRED" }
  /** Could not reach Cognito. The session may be fine -- do not sign out. */
  | { status: "UNAVAILABLE" };

function tokenClaims(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
  } catch {
    return null;
  }
}

/** Which Cognito pool minted this token, read from its `iss` claim. */
function poolOfToken(token: string): CognitoPoolType | null {
  const issuer = tokenClaims(token)?.iss;
  if (typeof issuer !== "string") return null;
  if (issuer.endsWith(`/${COGNITO_CONFIG.candidatePoolId}`)) return "CANDIDATE";
  if (issuer.endsWith(`/${COGNITO_CONFIG.businessPoolId}`)) return "BUSINESS";
  return null;
}

export function isTokenFresh(token: string): boolean {
  const expiration = getTokenExpiration(token);
  return expiration !== null && expiration * 1000 - Date.now() > REFRESH_LEEWAY_MS;
}

let inFlight: Promise<RefreshResult> | null = null;

async function refresh(force: boolean): Promise<RefreshResult> {
  const stored = getStoredToken();
  if (!stored) return { status: "EXPIRED" };

  const pool = poolOfToken(stored);
  if (!pool) {
    // Not a Cognito token we can renew (e.g. a dev bearer token).
    return isTokenFresh(stored) ? { status: "OK", token: stored } : { status: "EXPIRED" };
  }

  try {
    configureAmplify(pool);
    const session = await fetchAuthSession({ forceRefresh: force });
    const token = session.tokens?.accessToken?.toString();
    if (!token) return { status: "EXPIRED" };
    if (token !== stored) setStoredToken(token);
    return { status: "OK", token };
  } catch {
    return { status: "UNAVAILABLE" };
  }
}

/**
 * Renew the stored access token from the refresh token. Concurrent callers
 * share one request, so a burst of API calls does not become a burst of
 * refreshes.
 */
export function refreshSession(force = true): Promise<RefreshResult> {
  if (!inFlight) {
    inFlight = refresh(force).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

/**
 * The token to put on a request: the stored one while it has time left,
 * otherwise a renewed one. Falls back to the stored token if Cognito cannot be
 * reached, and lets the server's 401 decide.
 */
export async function getFreshToken(): Promise<string | null> {
  const stored = getStoredToken();
  if (!stored) return null;
  if (isTokenFresh(stored)) return stored;

  const result = await refreshSession(false);
  return result.status === "OK" ? result.token : stored;
}
