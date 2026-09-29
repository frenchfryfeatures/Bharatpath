/**
 * Client-side store for the backend RS256 bearer token minted at sign-in.
 *
 * The browser calls the backend directly (cross-origin), so the HTTP-only
 * session cookie cannot authenticate those requests. The sign-in route returns
 * the token in its response body; we keep it here and attach it as the
 * `Authorization` header on every API call.
 */

const TOKEN_KEY = "bharatpath_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredToken(token: string): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore storage failures (private mode, quota) */
  }
}

export function clearStoredToken(): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore storage failures */
  }
}
