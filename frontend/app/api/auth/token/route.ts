import { NextResponse } from "next/server";

import {
  AuthConfigurationError,
  backendBaseUrl,
  loadAccount,
  portalForRole,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/backend-auth";

const UPSTREAM_HEADERS = {
  "content-type": "application/json",
};

export async function POST(request: Request) {
  let email = "";

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
  } catch {
    return NextResponse.json(
      { detail: "Invalid request body." },
      { status: 400 },
    );
  }

  if (!email) {
    return NextResponse.json(
      { detail: "Email is required." },
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

  let account;

  try {
    account = await loadAccount(email);
  } catch (error) {
    console.error("Could not read the account directory.", error);

    return NextResponse.json(
      { detail: "The account directory is unavailable on this server." },
      { status: 500 },
    );
  }

  if (!account) {
    return NextResponse.json(
      { detail: "No account found for that email. Signed up on this site? Continue from the sign-up page with the same email." },
      { status: 401 },
    );
  }

  // 1. Mint a real RS256 token for this account's subject and pool.
  let tokenResponse: Response;

  try {
    tokenResponse = await fetch(`${base}/auth/dev/token`, {
      method: "POST",
      cache: "no-store",
      headers: UPSTREAM_HEADERS,
      body: JSON.stringify({
        subject: account.subject,
        pool: account.pool,
        email: account.email,
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
          "Token sign-in is disabled on the backend. Set AUTH_ALLOW_LOCAL_TOKENS=true and restart it.",
      },
      { status: 503 },
    );
  }

  if (!tokenResponse.ok) {
    return NextResponse.json(
      { detail: "Could not sign you in. Please try again." },
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

  // 2. Resolve the authoritative identity for that token.
  let meResponse: Response;

  try {
    meResponse = await fetch(`${base}/auth/me`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (error) {
    console.error("Identity endpoint unreachable.", error);

    return NextResponse.json(
      { detail: "The authentication service is unavailable. Please try again." },
      { status: 502 },
    );
  }

  if (!meResponse.ok) {
    const detail =
      meResponse.status === 403
        ? "This account has no active membership yet."
        : "Could not confirm your account. Please try again.";

    return NextResponse.json({ detail }, { status: meResponse.status });
  }

  const me = (await meResponse.json()) as {
    user_id?: string;
    role?: string;
    tenant_id?: string | null;
  };

  const role = typeof me.role === "string" ? me.role : account.role;
  const mapping = portalForRole(role);

  const response = NextResponse.json({
    user: {
      id: me.user_id ?? account.subject,
      email: account.email,
      name: account.email,
      role: mapping.authRole,
      tenantId: me.tenant_id ?? undefined,
    },
    portal: mapping.portal,
    path: mapping.path,
    backendRole: role,
    token: accessToken,
  });

  response.cookies.set(SESSION_COOKIE, accessToken, sessionCookieOptions());

  return response;
}
