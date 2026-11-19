const PROTECTED_PORTAL_PREFIXES = ["/student", "/employer", "/college", "/admin"] as const;

export function isProtectedPortalPath(pathname: string): boolean {
  if (pathname === "/admin/login" || pathname.startsWith("/admin/login/")) {
    return false;
  }
  return PROTECTED_PORTAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function isPublicAuthPath(pathname: string): boolean {
  return !isProtectedPortalPath(pathname);
}
