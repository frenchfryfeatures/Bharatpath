import { createHash } from "node:crypto";

import { NextResponse } from "next/server";

import {
  AuthConfigurationError,
  backendBaseUrl,
  loadAccount,
  portalForRole,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/backend-auth";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type SignupPool = "CANDIDATE" | "BUSINESS";

/*
 * Self-registration in local development, for candidates and businesses.
 *
 * In a deployed environment the browser talks to Cognito (`SignUp` ->
 * emailed code -> `ConfirmSignUp`, plus MFA for businesses). Locally there is
 * no pool, so this route stands in for it: it mints a token for the requested
 * pool through the backend's dev token endpoint. The subject is derived from
 * the email, so signing up again with the same address resumes the same
 * account rather than creating a second one.
 *
 * A candidate's first `/auth/me` creates their account. A business account
 * with no organisation answers 403 `no_active_membership`, which is the
 * expected "create your organisation" state, not a failure.
 */
function signupSubject(email: string, pool: SignupPool): string {
  const digest = createHash("sha256")
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);

  return pool === "CANDIDATE"
    ? `local-signup-candidate-${digest}`
    : `local-signup-${digest}`;
}

async function problemCode(response: Response): Promise<string | undefined> {
  try {
    const body: unknown = await response.json();

    return body &&
      typeof body === "object" &&
      "code" in body &&
      typeof body.code === "string"
      ? body.code
      : undefined;
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  let email = "";
  let pool: SignupPool = "BUSINESS";

  try {
    const body: unknown = await request.json();

    if (
      body &&
      typeof body === "object" &&
      "email" in body &&
      typeof body.email === "string"
    ) {
      email = body.email.trim();
    }

    if (body && typeof body === "object" && "pool" in body) {
      if (body.pool !== "CANDIDATE" && body.pool !== "BUSINESS") {
        return NextResponse.json(
          { detail: "Unknown account type." },
          { status: 400 },
        );
      }
      pool = body.pool;
    }
  } catch {
    return NextResponse.json(
      { detail: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!email || email.length > 255 || !EMAIL_PATTERN.test(email)) {
    return NextResponse.json(
      { detail: "Enter a valid email address." },
      { status: 400 },
    );
  }

  let base: string;

  try {
    base = backendBaseUrl();
  } catch (error) {
    if (error instanceof AuthConfigurationError) {
      console.error(error.message);

      return NextResponse.json(
        { detail: "Authentication is not configured on this server." },
        { status: 500 },
      );
    }

    throw error;
  }

  // A seeded account already has a sign-in of its own; it must use it.
  try {
    if (await loadAccount(email)) {
      return NextResponse.json(
        {
          detail: "An account already exists for this email. Sign in instead.",
          code: "account_exists",
        },
        { status: 409 },
      );
    }
  } catch (error) {
    // The directory only guards against duplicates; sign-up does not need it.
    console.warn("Could not read the account directory.", error);
  }

  let tokenResponse: Response;

  try {
    tokenResponse = await fetch(`${base}/auth/dev/token`, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        subject: signupSubject(email, pool),
        pool,
        email,
      }),
    });
  } catch (error) {
    console.error("Token endpoint unreachable.", error);

    return NextResponse.json(
      { detail: "The authentication service is unavailable. Please try again." },
      { status: 502 },
    );
  }

  if (tokenResponse.status === 404) {
    return NextResponse.json(
      {
        detail:
          "Sign-up is disabled on the backend. Set AUTH_ALLOW_LOCAL_TOKENS=true and restart it.",
      },
      { status: 503 },
    );
  }

  if (!tokenResponse.ok) {
    return NextResponse.json(
      { detail: "Could not create your account. Please try again." },
      { status: 502 },
    );
  }

  const tokenBody: unknown = await tokenResponse.json();
  const accessToken =
    tokenBody &&
    typeof tokenBody === "object" &&
    "access_token" in tokenBody &&
    typeof tokenBody.access_token === "string"
      ? tokenBody.access_token
      : "";

  if (!accessToken) {
    return NextResponse.json(
      { detail: "The authentication service returned an invalid token." },
      { status: 502 },
    );
  }

  let meResponse: Response;

  try {
    meResponse = await fetch(`${base}/auth/me`, {
      method: "GET",
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    console.error("Identity endpoint unreachable.", error);

    return NextResponse.json(
      { detail: "The authentication service is unavailable. Please try again." },
      { status: 502 },
    );
  }

  let role = "";
  let userId = "";
  let tenantId: string | undefined;
  let needsOrganisation = false;

  if (meResponse.ok) {
    const me = (await meResponse.json()) as {
      user_id?: string;
      role?: string;
      tenant_id?: string | null;
    };

    role = me.role ?? "";
    userId = me.user_id ?? "";
    tenantId = me.tenant_id ?? undefined;
  } else {
    const code = await problemCode(meResponse);

    if (
      pool === "BUSINESS" &&
      meResponse.status === 403 &&
      code === "no_active_membership"
    ) {
      needsOrganisation = true;
    } else {
      const detail =
        code === "account_contact_in_use"
          ? pool === "BUSINESS"
            ? "This email is already used by a candidate account. Use a different email for your business."
            : "This email is already used by an employer or college account. Use a different email."
          : code === "account_inactive"
            ? "This account is no longer active."
            : "Could not create your account. Please try again.";

      return NextResponse.json(
        { detail, code },
        { status: meResponse.status >= 500 ? 502 : meResponse.status },
      );
    }
  }

  const mapping = needsOrganisation
    ? { portal: "employer", path: "/employer", authRole: "EMPLOYER" as const }
    : portalForRole(role);

  const response = NextResponse.json({
    user: {
      id: userId,
      email,
      name: email,
      role: mapping.authRole,
      tenantId,
    },
    portal: mapping.portal,
    path: mapping.path,
    backendRole: role,
    needsOrganisation,
    token: accessToken,
  });

  response.cookies.set(SESSION_COOKIE, accessToken, sessionCookieOptions());

  return response;
}
