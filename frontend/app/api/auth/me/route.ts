import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import {
  AuthConfigurationError,
  backendBaseUrl,
  portalForRole,
  SESSION_COOKIE,
} from "@/lib/auth/backend-auth";

export async function GET() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;

  if (!token) {
    return NextResponse.json(
      { detail: "You are not signed in." },
      { status: 401 },
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

  let upstream: Response;

  try {
    upstream = await fetch(`${base}/auth/me`, {
      method: "GET",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    console.error("Identity endpoint unreachable.", error);

    return NextResponse.json(
      { detail: "The authentication service is unavailable." },
      { status: 502 },
    );
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { detail: "Your session is no longer valid." },
      { status: 401 },
    );
  }

  const me = (await upstream.json()) as {
    user_id?: string;
    role?: string;
    tenant_id?: string | null;
  };

  const mapping = portalForRole(
    typeof me.role === "string" ? me.role : "",
  );
  // The backend's /auth/me carries no email. The token it has just accepted
  // does, so read the signed-in person's own address from it.
  const email = emailClaim(token);

  return NextResponse.json({
    user: {
      id: me.user_id ?? "",
      email,
      name: email,
      role: mapping.authRole,
      tenantId: me.tenant_id ?? undefined,
    },
    portal: mapping.portal,
    path: mapping.path,
    backendRole: me.role ?? "",
  });
}

function emailClaim(token: string): string {
  try {
    const payload = token.split(".")[1];
    if (!payload) {
      return "";
    }
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf-8"),
    );
    return claims &&
      typeof claims === "object" &&
      "email" in claims &&
      typeof claims.email === "string"
      ? claims.email
      : "";
  } catch {
    return "";
  }
}
