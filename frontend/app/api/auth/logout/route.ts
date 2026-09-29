import { NextResponse } from "next/server";

import {
  SESSION_COOKIE,
  sessionCookieOptions,
} from "@/lib/auth/backend-auth";

function clearSession(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });

  return response;
}

export async function POST() {
  return clearSession(
    NextResponse.json({ status: "signed_out" }),
  );
}

export async function GET(request: Request) {
  return clearSession(
    NextResponse.redirect(new URL("/login", request.url)),
  );
}
