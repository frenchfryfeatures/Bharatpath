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

/** Clear browser-persisted authentication and session material on logout. */
export function clearBrowserAuthStorage(): void {
  if (typeof window === "undefined") return;

  clearStoredToken();

  const isAuthKey = (key: string) => {
    const normalized = key.toLowerCase();
    return ["auth", "session", "token", "identity", "cognito", "amplify"]
      .some((term) => normalized.includes(term));
  };

  try {
    for (const key of Object.keys(window.localStorage)) {
      if (isAuthKey(key)) window.localStorage.removeItem(key);
    }
  } catch {
    // Storage may be disabled by browser privacy settings.
  }

  try {
    for (const key of Object.keys(window.sessionStorage)) {
      if (isAuthKey(key)) window.sessionStorage.removeItem(key);
    }
  } catch {
    // Storage may be disabled by browser privacy settings.
  }

  // JavaScript can expire only cookies that are not HttpOnly. Cognito's
  // signOut handles its own provider session cookies where applicable.
  try {
    const cookieNames = document.cookie
      .split(";")
      .map((cookie) => cookie.trim().split("=")[0])
      .filter((name) => name && isAuthKey(name));
    const paths = new Set(["/", window.location.pathname]);
    for (const name of cookieNames) {
      for (const path of paths) {
        document.cookie = `${name}=; Max-Age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}; SameSite=Lax`;
      }
    }
  } catch {
    // Cookie access may be disabled by browser privacy settings.
  }
}
