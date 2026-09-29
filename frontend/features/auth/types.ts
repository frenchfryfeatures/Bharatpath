export type UserRole =
  | "STUDENT"
  | "ADMIN"
  | "EMPLOYER"
  | "COLLEGE";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  /** The backend membership role (e.g. EMPLOYER_OWNER, PLATFORM_ADMIN). */
  backendRole?: string;
  tenantId?: string;
  tenantSlug?: string;
  tenantName?: string;
}

export interface LoginRequest {
  email: string;
}

export interface LoginResponse {
  user: AuthUser;
  /** The portal that serves this account: student | employer | college | admin. */
  portal: string;
  /** The path to redirect to after a successful sign-in. */
  path: string;
  /** The authoritative backend membership role (e.g. EMPLOYER_OWNER). */
  backendRole: string;
  /**
   * The backend RS256 bearer token for this session. Returned by the sign-in
   * route so the browser can authenticate its direct backend calls.
   */
  token?: string;
}

export interface SignupRequest {
  email: string;
  /** Which Cognito pool the account belongs to. Defaults to BUSINESS. */
  pool?: "CANDIDATE" | "BUSINESS";
}

export interface SignupResponse extends LoginResponse {
  /**
   * True for a new business account that belongs to no organisation yet
   * (`/auth/me` answered 403 `no_active_membership`). The next step is
   * creating one.
   */
  needsOrganisation: boolean;
}
