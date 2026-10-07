import { ApiError } from "@/lib/api/errors";
import { backendBaseUrl, portalForRole } from "@/lib/auth/backend-auth";
import { handleSessionExpired } from "@/lib/auth/handle-session-expired";
import {
  configureAmplify,
  confirmSignUpCognito,
  confirmTotpCodeCognito,
  formatCognitoError,
  resendSignUpCodeCognito,
  signInWithCognito,
  signOutCognito,
  signUpWithCognito,
  verifyTotpSetupCognito,
} from "@/lib/auth/cognito";
import { getFreshToken, refreshSession } from "@/lib/auth/refresh-session";
import { clearBrowserAuthStorage, setStoredToken } from "@/lib/auth/token";
import { clearSession } from "@/lib/auth/session";
import { LoginResponse, SignupRequest, SignupResponse } from "../types";

/*
 * Every call here goes straight to the backend from the browser - there is
 * no Next.js route standing in between. The backend's RS256 bearer token is
 * what authenticates subsequent requests (kept in `lib/auth/token`, attached
 * as `Authorization` by the API clients); nothing here sets a cookie.
 */

function extractEmailFromJwt(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (!payload) return "";
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const jsonStr = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const claims = JSON.parse(jsonStr) as Record<string, unknown>;
    return (
      (claims.email as string) ||
      (claims.username as string) ||
      (claims["cognito:username"] as string) ||
      ""
    );
  } catch {
    return "";
  }
}

function emailAddress(value: unknown): string {
  return typeof value === "string" && EMAIL_PATTERN.test(value.trim()) ? value.trim() : "";
}

/** Resolve the signed-in identity from a backend access token, and store it. */
async function resolveSession(
  accessToken: string,
  email: string,
  fallback: { pool: "CANDIDATE" | "BUSINESS" },
  options: { signup?: boolean } = {},
): Promise<LoginResponse & { needsOrganisation: boolean }> {
  let meResponse: Response;

  try {
    meResponse = await fetch(`${backendBaseUrl()}/auth/me`, {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch {
    throw new ApiError(
      "The authentication service is unavailable. Please try again.",
      502,
      "AUTH_ERROR",
    );
  }

  const resolvedEmail = emailAddress(email) || emailAddress(extractEmailFromJwt(accessToken));

  if (!meResponse.ok) {
    const isBusiness = fallback.pool === "BUSINESS";

    // On sign-in a 403 always means "business account with no organisation
    // yet"; let them in to create one. On sign-up that is true only for the
    // `no_active_membership` code - other 403s (a conflicting pool, an
    // inactive account) must still error.
    if (meResponse.status === 403 && (!options.signup || isBusiness)) {
      let code: string | undefined;
      if (options.signup) {
        try {
          const body = (await meResponse.json()) as { code?: string };
          code = body.code;
        } catch {
          /* fall through to error below */
        }
      }

      if (!options.signup || code === "no_active_membership") {
        const mapping = isBusiness
          ? { portal: "employer" as const, path: "/employer", authRole: "EMPLOYER" as const }
          : { portal: "student" as const, path: "/student", authRole: "STUDENT" as const };

        setStoredToken(accessToken);

        return {
          user: {
            id: "",
            email: resolvedEmail,
            name: resolvedEmail,
            role: mapping.authRole,
          },
          portal: mapping.portal,
          path: mapping.path,
          backendRole: "NO_ACTIVE_MEMBERSHIP",
          needsOrganisation: isBusiness,
          token: accessToken,
        };
      }

      throw new ApiError(
        "Could not create your account. Please try again.",
        meResponse.status,
        code,
      );
    }

    let detail = "Could not confirm your account with the server.";
    let code: string | undefined;
    try {
      const body = (await meResponse.json()) as { detail?: string; code?: string };
      if (body.detail) detail = body.detail;
      code = body.code;
    } catch {
      /* keep default detail */
    }

    throw new ApiError(detail, meResponse.status, code ?? "AUTH_ERROR");
  }

  const me = (await meResponse.json()) as {
    user_id?: string;
    role?: string;
    tenant_id?: string | null;
    email?: string | null;
    full_name?: string | null;
  };

  const role = typeof me.role === "string" ? me.role : "CANDIDATE";
  const mapping = portalForRole(role);
  // `/auth/me` is authoritative. Cognito's username claim may be an opaque
  // subject/UUID, so it must never become a user-facing email or name.
  const accountEmail = emailAddress(me.email) || resolvedEmail;
  const accountName =
    typeof me.full_name === "string" && me.full_name.trim()
      ? me.full_name.trim()
      : accountEmail;

  setStoredToken(accessToken);

  return {
    user: {
      id: me.user_id ?? "",
      email: accountEmail,
      name: accountName,
      role: mapping.authRole,
      tenantId: me.tenant_id ?? undefined,
    },
    portal: mapping.portal,
    path: mapping.path,
    backendRole: role,
    needsOrganisation: false,
    token: accessToken,
  };
}

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export type CompleteSignupResult =
  | { status: "COMPLETE"; session: SignupResponse }
  | { status: "TOTP_SETUP_REQUIRED"; sharedSecret: string; setupUri: string }
  | { status: "TOTP_REQUIRED" }
  | { status: "SIGN_IN_REQUIRED" };

function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  const name = (error as { name?: string } | null)?.name;
  return new ApiError(
    formatCognitoError(error),
    name === "UsernameExistsException" ? 409 : 400,
    "AUTH_ERROR",
  );
}

function alreadyConfirmed(error: unknown): boolean {
  const cognitoError = error as { name?: string; message?: string } | null;
  return cognitoError?.name === "NotAuthorizedException" &&
    /current status is confirmed/i.test(cognitoError.message ?? "");
}

async function signedUpSession(
  accessToken: string,
  email: string,
  pool: "CANDIDATE" | "BUSINESS",
): Promise<SignupResponse> {
  try {
    return await resolveSession(accessToken, email, { pool }, { signup: true });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail =
        error.code === "account_contact_in_use"
          ? pool === "BUSINESS"
            ? "This email is already used by a candidate account. Use a different email for your business."
            : "This email is already used by an employer or college account. Use a different email."
          : error.code === "account_inactive"
            ? "This account is no longer active."
            : error.message;

      throw new ApiError(detail, error.status, error.code);
    }
    throw error;
  }
}

export const authService = {
  /**
   * Resolve identity from a Cognito access token obtained directly in the
   * browser, and store it as the backend bearer token.
   */
  async loginWithToken(
    token: string,
    email?: string,
    pool: "CANDIDATE" | "BUSINESS" = "CANDIDATE",
  ): Promise<LoginResponse> {
    return resolveSession(token, email ?? "", { pool });
  },

  /**
   * Self-registration in a Cognito pool. Cognito emails a confirmation code;
   * the account is usable only after `completeSignup` confirms it.
   */
  async signup(payload: SignupRequest): Promise<void> {
    const email = payload.email.trim();

    if (!email || email.length > 255 || !EMAIL_PATTERN.test(email)) {
      throw new ApiError("Enter a valid email address.", 400, "AUTH_ERROR");
    }

    try {
      await signUpWithCognito({
        email,
        password: payload.password,
        pool: payload.pool,
      });
    } catch (error) {
      throw toApiError(error);
    }
  },

  /**
   * Confirm the emailed code, then sign in with the password just chosen.
   */
  async completeSignup(payload: {
    email: string;
    password: string;
    code: string;
    pool: "CANDIDATE" | "BUSINESS";
  }): Promise<CompleteSignupResult> {
    const email = payload.email.trim();

    try {
      try {
        await confirmSignUpCognito(email, payload.code);
      } catch (error) {
        // A previous attempt can confirm the email before MFA setup finishes.
        // Continue with password sign-in so the same user can resume setup.
        if (!alreadyConfirmed(error)) throw error;
      }
      const result = await signInWithCognito({
        email,
        password: payload.password,
        pool: payload.pool,
      });

      if (result.status === "COMPLETE") {
        return {
          status: "COMPLETE",
          session: await signedUpSession(result.accessToken, email, payload.pool),
        };
      }

      if (result.status === "TOTP_SETUP_REQUIRED" || result.status === "TOTP_REQUIRED") {
        return result;
      }

      return { status: "SIGN_IN_REQUIRED" };
    } catch (error) {
      throw toApiError(error);
    }
  },

  /** Finish the sign-in challenge started after email confirmation. */
  async completeSignupTotp(payload: {
    email: string;
    code: string;
    pool: "CANDIDATE" | "BUSINESS";
    setup: boolean;
  }): Promise<SignupResponse> {
    try {
      const result = payload.setup
        ? await verifyTotpSetupCognito(payload.code)
        : await confirmTotpCodeCognito(payload.code);
      if (result.status !== "COMPLETE") {
        throw new ApiError("Authenticator verification did not finish. Please try again.", 400, "AUTH_ERROR");
      }
      return await signedUpSession(result.accessToken, payload.email, payload.pool);
    } catch (error) {
      throw toApiError(error);
    }
  },

  async resendSignupCode(email: string, pool: "CANDIDATE" | "BUSINESS"): Promise<void> {
    try {
      configureAmplify(pool);
      await resendSignUpCodeCognito(email);
    } catch (error) {
      throw toApiError(error);
    }
  },

  async logout(): Promise<void> {
    try {
      await signOutCognito();
    } finally {
      clearBrowserAuthStorage();
      clearSession();
    }
  },

  async me(): Promise<LoginResponse> {
    const token = await getFreshToken();
    if (!token) {
      throw new ApiError("You are not signed in.", 401, "AUTH_ERROR");
    }

    try {
      return await resolveSession(token, "", { pool: "CANDIDATE" });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        const renewed = await refreshSession(true);
        if (renewed.status === "OK") {
          return resolveSession(renewed.token, "", { pool: "CANDIDATE" });
        }
        if (renewed.status === "EXPIRED") handleSessionExpired();
      }
      throw error;
    }
  },
};
