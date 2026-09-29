import { ApiError } from "@/lib/api/errors";
import {
  LoginRequest,
  LoginResponse,
  SignupRequest,
  SignupResponse,
} from "../types";

async function authRequest<T>(
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body
        ? { "Content-Type": "application/json" }
        : {}),
      ...init.headers,
    },
  });

  const contentType =
    response.headers.get("content-type") ?? "";
  const result: unknown = contentType.includes(
    "application/json",
  )
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const detail =
      result &&
      typeof result === "object" &&
      "detail" in result &&
      typeof result.detail === "string"
        ? result.detail
        : "Authentication request failed.";

    throw new ApiError(
      detail,
      response.status,
      "AUTH_ERROR",
    );
  }

  return result as T;
}

export const authService = {
  /**
   * Email-only sign-in. The server route mints a backend token for the
   * account, stores it in an HTTP-only cookie, and returns the resolved
   * identity and destination portal.
   */
  async login(
    payload: LoginRequest,
  ): Promise<LoginResponse> {
    return authRequest<LoginResponse>(
      "/api/auth/token",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  /**
   * Employer self-registration. Creates (or resumes) a business account for
   * the email and signs it in, exactly as `login` does.
   */
  async signupEmployer(
    payload: SignupRequest,
  ): Promise<SignupResponse> {
    return authRequest<SignupResponse>(
      "/api/auth/signup",
      {
        method: "POST",
        body: JSON.stringify(payload),
      },
    );
  },

  /**
   * Candidate self-registration. Creates (or resumes) a candidate account for
   * the email and signs it in.
   */
  async signupCandidate(email: string): Promise<SignupResponse> {
    return authRequest<SignupResponse>(
      "/api/auth/signup",
      {
        method: "POST",
        body: JSON.stringify({ email, pool: "CANDIDATE" }),
      },
    );
  },

  async logout(): Promise<void> {
    await authRequest<{ status: string }>(
      "/api/auth/logout",
      { method: "POST" },
    );
  },

  async me(): Promise<LoginResponse> {
    return authRequest<LoginResponse>(
      "/api/auth/me",
      { method: "GET" },
    );
  },
};
