/**
 * Everything the website links to outside itself lives here, so the portal
 * address and the store listings change in one place.
 *
 * There is deliberately no admin link anywhere on the website: staff sign in
 * from the portal's own `/login`, which no page here points to.
 */

const trim = (url: string) => url.replace(/\/+$/, "");

export const PORTAL_URL = trim(process.env.NEXT_PUBLIC_PORTAL_URL || "http://localhost:3000");
export const SITE_URL = trim(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3100");
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hello@bharatpath.com";

export const PLAY_STORE_URL =
  process.env.NEXT_PUBLIC_PLAY_STORE_URL ||
  "https://play.google.com/store/apps/details?id=com.bharatpath.app";
/** Empty until the iOS listing exists; the badge then says "Coming soon". */
export const APP_STORE_URL = process.env.NEXT_PUBLIC_APP_STORE_URL || "";

export type Audience = "student" | "employer" | "college";

export const AUDIENCES: readonly Audience[] = ["student", "employer", "college"];

/** The portal's sign-in, locked to one audience (`?as=` hides the role switch). */
export function portalLoginUrl(audience: Audience, email?: string): string {
  const params = new URLSearchParams({ as: audience });
  if (email) params.set("email", email);
  return `${PORTAL_URL}/login?${params.toString()}`;
}

/** The portal's own sign-up flow for that audience. */
export function portalSignupUrl(audience: Audience): string {
  return `${PORTAL_URL}/signup/${audience}`;
}

export const NAV_LINKS = [
  { href: "/jobs/", label: "Find jobs" },
  { href: "/employers/", label: "Employers" },
  { href: "/colleges/", label: "Colleges" },
  { href: "/students/", label: "Students" },
  { href: "/about/", label: "About" },
] as const;
