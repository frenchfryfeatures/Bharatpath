import type { AuthUser } from "@/features/auth/types";

export type ProtectedPortal = "admin" | "employer" | "college" | "student";

const ADMIN_ROLES = ["PLATFORM_ADMIN", "KYB_REVIEWER", "INTEGRITY_REVIEWER", "SUPPORT_AGENT"];

const ADMIN_SECTIONS: Record<string, readonly string[]> = {
  dashboard: ADMIN_ROLES,
  queue: ["PLATFORM_ADMIN", "KYB_REVIEWER", "INTEGRITY_REVIEWER"],
  users: ["PLATFORM_ADMIN"],
  disputes: ["PLATFORM_ADMIN", "SUPPORT_AGENT"],
  audit: ["PLATFORM_ADMIN"],
  "search-filters": ["PLATFORM_ADMIN", "SUPPORT_AGENT"],
  courses: ["PLATFORM_ADMIN"],
  "discount-codes": ["PLATFORM_ADMIN", "SUPPORT_AGENT"],
  settings: ["PLATFORM_ADMIN"],
};

export function canAccessAdminQueueTab(role: string | undefined, tab: "kyb" | "integrity"): boolean {
  return role === "PLATFORM_ADMIN" || role === (tab === "kyb" ? "KYB_REVIEWER" : "INTEGRITY_REVIEWER");
}

export function canAccessPortalPath(user: AuthUser, portal: ProtectedPortal, pathname: string): boolean {
  const role = user.backendRole;
  if (pathname.split("/")[1] !== portal) return false;

  if (portal === "admin") {
    if (user.role !== "ADMIN" || !role) return false;
    const section = pathname.split("/")[2] || "dashboard";
    return Boolean(ADMIN_SECTIONS[section]?.includes(role));
  }
  if (portal === "employer") {
    return user.role === "EMPLOYER" &&
      (role === "NO_ACTIVE_MEMBERSHIP" || role === "EMPLOYER_OWNER" || role === "EMPLOYER_RECRUITER" || role === "EMPLOYER_VIEWER");
  }
  if (portal === "college") {
    return user.role === "COLLEGE" && (role === "COLLEGE_ADMIN" || role === "COLLEGE_STAFF");
  }
  return user.role === "STUDENT" && (role === "CANDIDATE" || role === "NO_ACTIVE_MEMBERSHIP");
}

export function homeForUser(user: AuthUser): string {
  switch (user.role) {
    case "ADMIN": return "/admin/dashboard";
    case "EMPLOYER": return "/employer";
    case "COLLEGE": return "/college";
    case "STUDENT": return "/student";
  }
}
