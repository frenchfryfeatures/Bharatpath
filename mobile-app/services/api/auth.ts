import {
  apiRequest,
  setAccessToken,
  getAccessToken,
  registerTokenRefreshHandler,
  ApiError,
  getBaseUrl,
} from './client';
import { UserProfile } from '@/types/user';
import { rememberUnsavedName } from '@/services/profile/pendingName';
import {
  saveStoredSession,
  getStoredSession,
  clearAllAuthData,
} from '@/services/storage/authStorage';

export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
  userId: string;
  email: string;
  role: string;
  pool: string;
  tenantId: string | null;
  subject?: string;
}

export interface MeResponse {
  user_id: string;
  role: string;
  pool: string;
  tenant_id: string | null;
}

export interface DevTokenResponse {
  access_token: string;
  token_type: string;
  subject: string;
  expires_in: number;
}

export interface CandidateProfileResponse {
  full_name: string | null;
  city: string | null;
  state_code: string | null;
  updated_at: string | null;
}

export interface SignUpParams {
  fullName: string;
  email: string;
  password: string;
}

export interface SignInParams {
  email: string;
  password: string;
}

// Known pre-existing dev subjects for local fallback
const devSubjectCache: Record<string, string> = {
  'test@gmail.com': 'f7cf75b0-bc28-41c9-a87c-728ec7fc9b00',
  'onlyritik10@gmail.com': '8a6403bc-e0fb-4c46-92ce-47bd7e66ae40',
  'rohan@gmail.com': '572f5bf9-fa74-439c-b577-f5cbfc3b69e9',
  'rish@gmail.com': 'e891265e-95a5-4547-a218-5130c1e18951',
  'priya.sharma@example.com': '7328bab6-a2ed-41f0-92f1-f1575b48b164',
  'candidate@example.com': '91ff19a0-b40b-4182-80e3-a02a764bcdd6',
  'test_cand_1@example.com': '3a47fc46-bcc2-42f6-93d0-58b15d8aa731',
  'deterministic_test@example.com': '12345678-1234-4234-a234-123456789abc',
};

/**
 * Deterministically derives a consistent UUID for a given email address during local dev.
 */
export function emailToDevSubject(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (devSubjectCache[normalized]) {
    return devSubjectCache[normalized];
  }

  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5;
  let h3 = 0x811c9dc5;
  let h4 = 0x811c9dc5;

  for (let i = 0; i < normalized.length; i++) {
    const code = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ (code + i), 0x01000193);
    h3 = Math.imul(h3 ^ (code * 31), 0x01000193);
    h4 = Math.imul(h4 ^ (code * 17), 0x01000193);
  }

  const hex1 = (h1 >>> 0).toString(16).padStart(8, '0');
  const hex2 = (h2 >>> 0).toString(16).padStart(8, '0');
  const hex3 = (h3 >>> 0).toString(16).padStart(8, '0');
  const hex4 = (h4 >>> 0).toString(16).padStart(8, '0');

  const fullHex = hex1 + hex2 + hex3 + hex4;
  const uuid = `${fullHex.slice(0, 8)}-${fullHex.slice(8, 12)}-4${fullHex.slice(13, 16)}-a${fullHex.slice(17, 20)}-${fullHex.slice(20, 32)}`;
  devSubjectCache[normalized] = uuid;
  return uuid;
}

const COGNITO_REGION = process.env.EXPO_PUBLIC_COGNITO_REGION || 'ap-south-1';
const COGNITO_CLIENT_ID = process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID || '7sm4qd9k4bitdseu05d1t9pt4u';

function shouldUseDevToken(): boolean {
  const baseUrl = getBaseUrl();
  const isLocalhost =
    baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1') || baseUrl.includes('192.168.');
  return process.env.EXPO_PUBLIC_AUTH_USE_DEV_TOKEN === 'true' && isLocalhost;
}

async function cognitoRequest<T>(action: string, payload: Record<string, any>): Promise<T> {
  const url = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-Amz-Target': `AWSCognitoIdentityProviderService.${action}`,
        'Content-Type': 'application/x-amz-json-1.1',
      },
      body: JSON.stringify(payload),
    });
  } catch (err: any) {
    throw new ApiError({
      type: 'https://bharatpath.example/problems/network_error',
      title: 'Cannot connect to authentication service. Please check your internet connection.',
      status: 0,
      code: 'network_error',
    });
  }

  const data = await response.json();
  if (!response.ok) {
    const errorType = (data.__type || data.code || '').split('#').pop() || 'CognitoError';
    const message = data.message || 'Authentication request failed';

    if (errorType === 'NotAuthorizedException' || errorType === 'UserNotFoundException') {
      throw new ApiError({
        type: 'https://bharatpath.example/problems/unauthenticated',
        title: 'Incorrect email or password.',
        status: 401,
        code: 'unauthenticated',
      });
    }
    if (errorType === 'UserNotConfirmedException') {
      throw new ApiError({
        type: 'https://bharatpath.example/problems/user_not_confirmed',
        title: 'Account not verified. Please verify your email with the confirmation code.',
        status: 403,
        code: 'user_not_confirmed',
      });
    }
    if (errorType === 'UsernameExistsException') {
      throw new ApiError({
        type: 'https://bharatpath.example/problems/conflict',
        title: 'An account with this email already exists. Please sign in instead.',
        status: 409,
        code: 'account_contact_in_use',
      });
    }
    if (errorType === 'InvalidPasswordException') {
      throw new ApiError({
        type: 'https://bharatpath.example/problems/invalid_password',
        title: message,
        status: 400,
        code: 'invalid_password',
      });
    }
    if (errorType === 'CodeMismatchException') {
      throw new ApiError({
        type: 'https://bharatpath.example/problems/invalid_code',
        title: 'Invalid verification code. Please check your email and try again.',
        status: 400,
        code: 'invalid_code',
      });
    }
    if (errorType === 'ExpiredCodeException') {
      throw new ApiError({
        type: 'https://bharatpath.example/problems/expired_code',
        title: 'Verification code has expired. Please request a new code.',
        status: 400,
        code: 'expired_code',
      });
    }
    if (errorType === 'LimitExceededException') {
      throw new ApiError({
        type: 'https://bharatpath.example/problems/limit_exceeded',
        title: 'Too many attempts. Please wait a few minutes before trying again.',
        status: 429,
        code: 'limit_exceeded',
      });
    }
    if (errorType === 'InvalidParameterException' && message.includes('no registered/verified email')) {
      throw new ApiError({
        type: 'https://bharatpath.example/problems/email_not_verified',
        title: 'This account email has not been verified yet. Please verify your email before resetting your password.',
        status: 400,
        code: 'email_not_verified',
      });
    }

    throw new ApiError({
      type: 'https://bharatpath.example/problems/cognito_error',
      title: message,
      status: response.status,
      code: errorType,
    });
  }

  return data as T;
}

let currentSession: AuthSession | null = null;

export type SessionChangeListener = (session: AuthSession | null) => void;
const sessionChangeListeners = new Set<SessionChangeListener>();

export function onSessionChange(listener: SessionChangeListener): () => void {
  sessionChangeListeners.add(listener);
  return () => {
    sessionChangeListeners.delete(listener);
  };
}

function notifySessionListeners(session: AuthSession | null): void {
  sessionChangeListeners.forEach((fn) => {
    try {
      fn(session);
    } catch (e) {
      console.warn('[Auth] Error notifying session listener:', e);
    }
  });
}

/** Refresh this long (in ms) before the access token expires (60 seconds leeway) */
export const REFRESH_LEEWAY_MS = 60_000;

function decodeBase64Url(base64Url: string): string {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  if (typeof atob === 'function') {
    return atob(padded);
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = padded.replace(/=+$/, '');
  let output = '';
  for (
    let bc = 0, bs = 0, buffer: number, idx = 0;
    (buffer = str.charCodeAt(idx++));
    ~buffer && ((bs = bc % 4 ? bs * 64 + buffer : buffer), bc++ % 4)
      ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))))
      : 0
  ) {
    buffer = chars.indexOf(String.fromCharCode(buffer));
  }
  return output;
}

/**
 * Extracts expiration timestamp (in milliseconds) from a JWT access token payload.
 */
export function parseJwtExpiration(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const raw = decodeBase64Url(parts[1]);
    const jsonStr = decodeURIComponent(
      raw
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    const claims = JSON.parse(jsonStr);
    return typeof claims.exp === 'number' && Number.isFinite(claims.exp)
      ? claims.exp * 1000
      : null;
  } catch {
    return null;
  }
}

/**
 * Checks if the current access token has at least 60 seconds of validity left.
 */
export function isSessionTokenFresh(session: AuthSession | null): boolean {
  if (!session || !session.accessToken) return false;
  let expiresAt = session.expiresAt;
  if (!expiresAt) {
    const parsed = parseJwtExpiration(session.accessToken);
    if (parsed) {
      expiresAt = parsed;
      session.expiresAt = parsed;
    }
  }
  if (!expiresAt) return true;
  return expiresAt - Date.now() > REFRESH_LEEWAY_MS;
}

let inFlightRefreshPromise: Promise<string | null> | null = null;

/**
 * Silent token renewal:
 * Trades the 30-day Cognito RefreshToken for a new 1-hour AccessToken.
 * Concurrent callers share a single in-flight promise to prevent the thundering herd problem.
 */
export async function refreshAccessToken(force = false): Promise<string | null> {
  if (!currentSession) {
    const stored = await getStoredSession();
    if (stored) {
      currentSession = stored;
      setAccessToken(stored.accessToken);
    }
  }

  if (!currentSession) {
    return null;
  }

  if (!force && isSessionTokenFresh(currentSession)) {
    return currentSession.accessToken;
  }

  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  inFlightRefreshPromise = (async () => {
    try {
      return await executeTokenRefresh();
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

async function executeTokenRefresh(): Promise<string | null> {
  if (!currentSession) return null;

  if (shouldUseDevToken()) {
    try {
      const devSubject = currentSession.subject || emailToDevSubject(currentSession.email);
      const tokenResponse = await apiRequest<DevTokenResponse>('/auth/dev/token', {
        method: 'POST',
        skipAuthRefresh: true,
        body: {
          pool: 'CANDIDATE',
          email: currentSession.email,
          subject: devSubject,
        },
      });

      const newAccessToken = tokenResponse.access_token;
      const expiresIn = tokenResponse.expires_in || 3600;
      const newExpiresAt = Date.now() + expiresIn * 1000;

      currentSession = {
        ...currentSession,
        accessToken: newAccessToken,
        expiresAt: newExpiresAt,
      };

      setAccessToken(newAccessToken);
      await saveStoredSession(currentSession);
      notifySessionListeners(currentSession);
      return newAccessToken;
    } catch (devErr) {
      console.warn('[Auth] Dev token refresh failed:', devErr);
      return currentSession.accessToken;
    }
  }

  const refreshToken = currentSession.refreshToken;
  if (!refreshToken) {
    console.warn('[Auth] No refresh token available in session. Cannot renew 30-day session.');
    return isSessionTokenFresh(currentSession) ? currentSession.accessToken : null;
  }

  try {
    console.log('[Auth] Initiating Cognito REFRESH_TOKEN_AUTH for 30-day session retention...');
    const authResult = await cognitoRequest<any>('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        REFRESH_TOKEN: refreshToken,
      },
    });

    const authRes = authResult?.AuthenticationResult;
    if (!authRes?.AccessToken) {
      console.warn('[Auth] InitiateAuth did not return an AccessToken');
      return null;
    }

    const newAccessToken = authRes.AccessToken;
    const expiresIn = typeof authRes.ExpiresIn === 'number' ? authRes.ExpiresIn : 3600;
    const newExpiresAt = Date.now() + expiresIn * 1000;
    const newRefreshToken = authRes.RefreshToken || refreshToken;
    const newIdToken = authRes.IdToken || currentSession.idToken;

    currentSession = {
      ...currentSession,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      idToken: newIdToken,
      expiresAt: newExpiresAt,
    };

    setAccessToken(newAccessToken);
    await saveStoredSession(currentSession);
    notifySessionListeners(currentSession);
    console.log(
      '[Auth] Token renewed successfully via Cognito RefreshToken. Valid until:',
      new Date(newExpiresAt).toISOString()
    );
    return newAccessToken;
  } catch (err: any) {
    console.warn('[Auth] Failed to refresh token via Cognito:', err);

    // If Cognito permanently rejected the refresh token (e.g. 30 days expired or revoked)
    if (
      err?.code === 'unauthenticated' ||
      err?.code === 'NotAuthorizedException' ||
      err?.code === 'UserNotFoundException'
    ) {
      console.warn('[Auth] 30-day refresh token expired or revoked. Signing out.');
      await signOut();
      return null;
    }

    // Network or transient Cognito error: Preserve session so app can retry when network recovers
    return currentSession?.accessToken || null;
  }
}

// Automatically bind token refresh handler to apiRequest client
registerTokenRefreshHandler(refreshAccessToken);

export type SignUpResult = AuthSession | { unconfirmed: true; email: string };

/**
 * Sign up a new candidate:
 * - In local dev mode: calls /auth/dev/token
 * - In production / hosted backend: calls AWS Cognito Candidate User Pool SignUp
 */
export async function signUpWithEmail(params: SignUpParams): Promise<SignUpResult> {
  const normalizedEmail = params.email.trim().toLowerCase();

  if (shouldUseDevToken()) {
    const devSubject = emailToDevSubject(normalizedEmail);

    const tokenResponse = await apiRequest<DevTokenResponse>('/auth/dev/token', {
      method: 'POST',
      body: {
        pool: 'CANDIDATE',
        email: normalizedEmail,
        subject: devSubject,
      },
    });

    const accessToken = tokenResponse.access_token;
    setAccessToken(accessToken);

    const me = await apiRequest<MeResponse>('/auth/me', {
      token: accessToken,
    });

    const fullName = params.fullName.trim();
    if (fullName) {
      const saveName = () =>
        apiRequest<CandidateProfileResponse>('/candidate/profile/name', {
          method: 'PUT',
          token: accessToken,
          body: { full_name: fullName },
        });
      try {
        await saveName();
      } catch (first) {
        console.warn('Retrying candidate name save after failure:', first);
        try {
          await saveName();
        } catch (second) {
          console.error('Could not save candidate name during signup:', second);
          rememberUnsavedName(fullName);
        }
      }
    }

    const expiresIn = tokenResponse.expires_in || 3600;
    const expiresAt = Date.now() + expiresIn * 1000;

    const session: AuthSession = {
      accessToken,
      expiresAt,
      userId: me.user_id,
      email: normalizedEmail,
      role: me.role,
      pool: me.pool,
      tenantId: me.tenant_id,
      subject: tokenResponse.subject,
    };

    currentSession = session;
    await saveStoredSession(session);
    notifySessionListeners(session);
    return session;
  }

  // AWS Cognito SignUp Flow
  await cognitoRequest<any>('SignUp', {
    ClientId: COGNITO_CLIENT_ID,
    Username: normalizedEmail,
    Password: params.password,
    UserAttributes: [
      { Name: 'email', Value: normalizedEmail },
      { Name: 'name', Value: params.fullName.trim() },
    ],
  });

  // Attempt sign in (if account was confirmed immediately)
  try {
    const { session } = await signInWithEmail({
      email: normalizedEmail,
      password: params.password,
    });

    const fullName = params.fullName.trim();
    if (fullName) {
      try {
        await updateCandidateName(fullName);
      } catch (err) {
        rememberUnsavedName(fullName);
      }
    }

    return session;
  } catch (err: any) {
    if (err?.code === 'user_not_confirmed') {
      return { unconfirmed: true, email: normalizedEmail };
    }
    throw err;
  }
}

/**
 * Sign in existing candidate:
 * - In local dev mode: calls /auth/dev/token
 * - In hosted mode: authenticates against AWS Cognito Candidate Pool via USER_PASSWORD_AUTH
 * - Captures AccessToken, RefreshToken (valid for 30 days), and ExpiresIn
 * - Then verifies identity on backend via GET /auth/me and fetches candidate profile.
 */
export async function signInWithEmail(params: SignInParams): Promise<{
  session: AuthSession;
  profile: CandidateProfileResponse | null;
}> {
  const normalizedEmail = params.email.trim().toLowerCase();
  let accessToken: string;
  let refreshToken: string | undefined;
  let idToken: string | undefined;
  let expiresAt: number;
  let subject: string | undefined;

  if (shouldUseDevToken()) {
    const devSubject = emailToDevSubject(normalizedEmail);
    const tokenResponse = await apiRequest<DevTokenResponse>('/auth/dev/token', {
      method: 'POST',
      skipAuthRefresh: true,
      body: {
        pool: 'CANDIDATE',
        email: normalizedEmail,
        subject: devSubject,
      },
    });
    accessToken = tokenResponse.access_token;
    subject = tokenResponse.subject;
    const expiresIn = tokenResponse.expires_in || 3600;
    expiresAt = Date.now() + expiresIn * 1000;
  } else {
    // AWS Cognito USER_PASSWORD_AUTH
    const authResult = await cognitoRequest<any>('InitiateAuth', {
      AuthFlow: 'USER_PASSWORD_AUTH',
      ClientId: COGNITO_CLIENT_ID,
      AuthParameters: {
        USERNAME: normalizedEmail,
        PASSWORD: params.password,
      },
    });

    const authRes = authResult?.AuthenticationResult;
    if (!authRes?.AccessToken) {
      throw new ApiError({
        type: 'https://bharatpath.example/problems/unauthenticated',
        title: 'Authentication did not return a valid session token.',
        status: 401,
        code: 'unauthenticated',
      });
    }

    accessToken = authRes.AccessToken;
    refreshToken = authRes.RefreshToken;
    idToken = authRes.IdToken;
    const expiresIn = typeof authRes.ExpiresIn === 'number' ? authRes.ExpiresIn : 3600;
    expiresAt = Date.now() + expiresIn * 1000;
  }

  setAccessToken(accessToken);

  // Verify identity on backend
  const me = await apiRequest<MeResponse>('/auth/me', {
    token: accessToken,
  });

  // Fetch candidate profile from backend
  let profile: CandidateProfileResponse | null = null;
  try {
    profile = await apiRequest<CandidateProfileResponse>('/candidate/profile', {
      token: accessToken,
    });
  } catch (err) {
    console.warn('Could not fetch candidate profile:', err);
  }

  const session: AuthSession = {
    accessToken,
    refreshToken,
    idToken,
    expiresAt,
    userId: me.user_id,
    email: normalizedEmail,
    role: me.role,
    pool: me.pool,
    tenantId: me.tenant_id,
    subject: subject || me.user_id,
  };

  currentSession = session;
  await saveStoredSession(session);
  notifySessionListeners(session);
  return { session, profile };
}

/**
 * Confirm Sign-up with 6-digit code (Cognito flow).
 */
export async function confirmSignUpWithCode(email: string, code: string): Promise<boolean> {
  if (shouldUseDevToken()) {
    return true;
  }
  const normalizedEmail = email.trim().toLowerCase();
  await cognitoRequest<any>('ConfirmSignUp', {
    ClientId: COGNITO_CLIENT_ID,
    Username: normalizedEmail,
    ConfirmationCode: code.trim(),
  });
  return true;
}

/**
 * Resend confirmation code for unconfirmed user.
 */
export async function resendConfirmationCode(email: string): Promise<boolean> {
  if (shouldUseDevToken()) {
    return true;
  }
  const normalizedEmail = email.trim().toLowerCase();
  await cognitoRequest<any>('ResendConfirmationCode', {
    ClientId: COGNITO_CLIENT_ID,
    Username: normalizedEmail,
  });
  return true;
}

/**
 * Request password reset code via AWS Cognito.
 */
export async function forgotPassword(email: string): Promise<boolean> {
  if (shouldUseDevToken()) {
    return true;
  }
  const normalizedEmail = email.trim().toLowerCase();
  await cognitoRequest<any>('ForgotPassword', {
    ClientId: COGNITO_CLIENT_ID,
    Username: normalizedEmail,
  });
  return true;
}

/**
 * Confirm password reset with 6-digit code and set new password.
 */
export async function confirmForgotPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<boolean> {
  if (shouldUseDevToken()) {
    return true;
  }
  const normalizedEmail = email.trim().toLowerCase();
  await cognitoRequest<any>('ConfirmForgotPassword', {
    ClientId: COGNITO_CLIENT_ID,
    Username: normalizedEmail,
    ConfirmationCode: code.trim(),
    Password: newPassword,
  });
  return true;
}

/**
 * Change password for the signed-in candidate using AWS Cognito.
 */
export async function changePassword(
  oldPassword: string,
  newPassword: string
): Promise<boolean> {
  if (shouldUseDevToken()) {
    return true;
  }
  const token = (await refreshAccessToken(false)) || getAccessToken();
  if (!token) {
    throw new ApiError({
      type: 'https://bharatpath.example/problems/unauthorized',
      title: 'You must be signed in to change your password.',
      status: 401,
      code: 'unauthorized',
    });
  }
  try {
    await cognitoRequest<any>('ChangePassword', {
      AccessToken: token,
      PreviousPassword: oldPassword,
      ProposedPassword: newPassword,
    });
    return true;
  } catch (err: any) {
    if (err instanceof ApiError && err.status === 401) {
      throw new ApiError({
        type: 'https://bharatpath.example/problems/invalid_password',
        title: 'Your current password is incorrect.',
        status: 400,
        code: 'invalid_current_password',
      });
    }
    throw err;
  }
}

/**
 * Get current caller's identity directly from backend (/auth/me)
 */
export async function getMe(): Promise<MeResponse | null> {
  const token = getAccessToken();
  if (!token) return null;
  try {
    return await apiRequest<MeResponse>('/auth/me');
  } catch {
    return null;
  }
}

/**
 * Update candidate full name (PUT /candidate/profile/name)
 */
export async function updateCandidateName(fullName: string): Promise<CandidateProfileResponse> {
  return await apiRequest<CandidateProfileResponse>('/candidate/profile/name', {
    method: 'PUT',
    body: {
      full_name: fullName.trim(),
    },
  });
}

/**
 * Update candidate location (PUT /candidate/profile/location)
 */
export async function updateCandidateLocation(
  city: string | null,
  stateCode: string | null
): Promise<CandidateProfileResponse> {
  return await apiRequest<CandidateProfileResponse>('/candidate/profile/location', {
    method: 'PUT',
    body: {
      city: city ? city.trim() : null,
      state_code: stateCode ? stateCode.trim().toUpperCase() : null,
    },
  });
}

/**
 * Get candidate's own profile (GET /candidate/profile)
 */
export async function getCandidateProfile(): Promise<CandidateProfileResponse> {
  return await apiRequest<CandidateProfileResponse>('/candidate/profile');
}

export { getProfileViews } from './profile';

export async function signOut(): Promise<void> {
  setAccessToken(null);
  currentSession = null;
  await clearAllAuthData();
  notifySessionListeners(null);
}

export async function getCurrentSession(): Promise<AuthSession | null> {
  if (currentSession) {
    if (!isSessionTokenFresh(currentSession) && currentSession.refreshToken) {
      await refreshAccessToken(true).catch(() => null);
    }
    return currentSession;
  }
  const stored = await getStoredSession();
  if (stored) {
    currentSession = stored;
    setAccessToken(stored.accessToken);
    if (!isSessionTokenFresh(stored) && stored.refreshToken) {
      await refreshAccessToken(true).catch(() => null);
    }
    return currentSession;
  }
  return null;
}

export async function getUserProfile(userId: string): Promise<UserProfile | null> {
  try {
    const cand = await getCandidateProfile();
    return {
      id: userId,
      fullName: cand.full_name || 'Candidate',
      email: currentSession?.email || '',
      city: cand.city || undefined,
      state: cand.state_code || undefined,
      preferredLanguage: 'en',
      education: [],
      skills: [],
      experience: [],
      readinessScore: 706,
      readinessBand: 1,
    };
  } catch {
    return null;
  }
}
