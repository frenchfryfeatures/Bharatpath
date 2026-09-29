import "server-only";

import { promises as fs } from "node:fs";
import path from "node:path";

import bundledAccounts from "./accounts.json";

/**
 * The HTTP-only cookie that carries the backend RS256 bearer token for the
 * signed-in user, set by the sign-in route (`app/api/auth/token`). Never
 * exposed to browser JavaScript.
 */
export const SESSION_COOKIE = "bharatpath_session";

export type Pool = "CANDIDATE" | "BUSINESS";

export type Portal = "student" | "employer" | "college" | "admin";

export type AuthRole = "STUDENT" | "EMPLOYER" | "COLLEGE" | "ADMIN";

export interface DevAccount {
  email: string;
  subject: string;
  pool: Pool;
  role: string;
  group: string;
}

export class AuthConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigurationError";
  }
}

/** The main backend base URL (e.g. http://127.0.0.1:8099/api/v1). */
export function backendBaseUrl(): string {
  const base = process.env.BACKEND_API_URL;

  if (!base) {
    throw new AuthConfigurationError(
      "BACKEND_API_URL is not configured.",
    );
  }

  return base.replace(/\/$/, "");
}

/*
 * The seeded account directory (written by backend/scripts/seed_demo.py) is
 * bundled with the frontend so a deployment that ships only this folder, such
 * as Vercel, can still resolve sign-ins. DEV_ACCOUNTS_FILE overrides it.
 */
async function readAccounts(): Promise<DevAccount[]> {
  const configured = process.env.DEV_ACCOUNTS_FILE;

  if (!configured) {
    return bundledAccounts as DevAccount[];
  }

  const raw = await fs.readFile(
    /* turbopackIgnore: true */ path.resolve(configured),
    "utf-8",
  );
  return JSON.parse(raw) as DevAccount[];
}

/**
 * Look up a seeded account by email. Returns `null` when the email is not in
 * the directory; throws when the directory itself cannot be read.
 */
export async function loadAccount(
  email: string,
): Promise<DevAccount | null> {
  const list = await readAccounts();
  const target = email.trim().toLowerCase();

  return (
    list.find(
      (account) =>
        typeof account?.email === "string" &&
        account.email.toLowerCase() === target,
    ) ?? null
  );
}

const STAFF_ROLES = new Set([
  "PLATFORM_ADMIN",
  "KYB_REVIEWER",
  "INTEGRITY_REVIEWER",
  "SUPPORT_AGENT",
]);

/** Map a backend membership role to the portal that serves it. */
export function portalForRole(role: string): {
  portal: Portal;
  path: string;
  authRole: AuthRole;
} {
  if (role === "CANDIDATE") {
    return { portal: "student", path: "/student", authRole: "STUDENT" };
  }

  if (role.startsWith("EMPLOYER")) {
    return { portal: "employer", path: "/employer", authRole: "EMPLOYER" };
  }

  if (role.startsWith("COLLEGE")) {
    return { portal: "college", path: "/college", authRole: "COLLEGE" };
  }

  if (STAFF_ROLES.has(role)) {
    return { portal: "admin", path: "/admin", authRole: "ADMIN" };
  }

  // A candidate holds no membership, so an unknown/blank role is treated as one.
  return { portal: "student", path: "/student", authRole: "STUDENT" };
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}
