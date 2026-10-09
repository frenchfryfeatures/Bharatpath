import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  code: string;
  instance?: string;
  request_id?: string;
  params?: Record<string, any>;
}

export class ApiError extends Error {
  problem: ProblemDetails;
  status: number;
  code: string;

  constructor(problem: ProblemDetails) {
    super(problem.title || problem.code || 'API Error');
    this.name = 'ApiError';
    this.problem = problem;
    this.status = problem.status;
    this.code = problem.code;
  }
}

// Stored token holder
let currentAccessToken: string | null = null;

export function setAccessToken(token: string | null) {
  currentAccessToken = token;
}

export function getAccessToken(): string | null {
  return currentAccessToken;
}

// Generate a random UUID string for request correlation (X-Request-ID)
function generateRequestId(): string {
  return 'req_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

// Get the base API URL based on platform and environment
export function getBaseUrl(): string {
  // 1. If EXPO_PUBLIC_API_BASE_URL is set in .env, honor explicit configuration
  const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // 2. On Web: default to localhost directly (browser is on the host Mac)
  if (Platform.OS === 'web') {
    return 'http://localhost:8099/api/v1';
  }

  // 3. If running via Expo Go on a physical phone, Metro hostUri gives the Mac's IP (e.g. 192.168.1.34:8081)
  const hostUri = Constants.expoConfig?.hostUri || (Constants as any).manifest2?.extra?.expoClient?.hostUri;
  if (hostUri) {
    const hostIp = hostUri.split(':')[0];
    if (hostIp && hostIp !== 'localhost' && hostIp !== '127.0.0.1') {
      return `http://${hostIp}:8099/api/v1`;
    }
  }

  // 4. Android emulator uses 10.0.2.2 to reach host machine
  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8099/api/v1';
  }

  // 5. Default fallback (iOS simulator or local host)
  return 'http://localhost:8099/api/v1';
}

export type TokenRefreshHandler = (force?: boolean) => Promise<string | null>;

let tokenRefreshHandler: TokenRefreshHandler | null = null;

export function registerTokenRefreshHandler(handler: TokenRefreshHandler | null): void {
  tokenRefreshHandler = handler;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: any;
  headers?: Record<string, string>;
  token?: string;
  skipAuthRefresh?: boolean;
  _isRetry?: boolean;
}

export async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions = {}
): Promise<T> {
  const baseUrl = getBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = `${baseUrl}${cleanEndpoint}`;

  // 1. Proactive freshness check: if using global session token and refresh is enabled,
  // ensure we have a fresh token before making the request.
  let token = options.token || currentAccessToken;
  if (!options.token && !options.skipAuthRefresh && tokenRefreshHandler) {
    try {
      const freshToken = await tokenRefreshHandler(false);
      if (freshToken) {
        token = freshToken;
      }
    } catch (refreshErr) {
      console.warn('[API Client] Proactive token freshness check failed:', refreshErr);
    }
  }

  const requestId = generateRequestId();

  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'X-Request-ID': requestId,
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
    ...options.headers,
  };

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const fetchOptions: RequestInit = {
    method: options.method || 'GET',
    headers,
    cache: 'no-store',
  };

  if (options.body) {
    fetchOptions.body =
      options.body instanceof FormData ? options.body : JSON.stringify(options.body);
  }

  let response: Response;
  try {
    console.log(`[API Request] ${options.method || 'GET'} ${url}`);
    response =
      Platform.OS !== 'web' && options.body instanceof FormData
        ? ((await expoFetch(
            url,
            fetchOptions as unknown as Parameters<typeof expoFetch>[1],
          )) as unknown as Response)
        : await fetch(url, fetchOptions);
  } catch (netErr: any) {
    console.error(`[API Network Error] ${options.method || 'GET'} ${url}:`, netErr);
    throw new ApiError({
      type: 'https://bharatpath.example/problems/network_error',
      title: `Cannot reach backend at ${url}. Please verify the backend API is running.`,
      status: 0,
      code: 'network_error',
      params: { url, originalError: netErr?.message || String(netErr) },
    });
  }

  // 2. Reactive 401 handling: If server returns 401 Unauthorized (e.g. invalid/expired token),
  // silently refresh via Cognito refresh token and retry the request once.
  if (response.status === 401 && !options._isRetry && !options.skipAuthRefresh && tokenRefreshHandler) {
    console.log(`[API Client] Received 401 on ${cleanEndpoint}. Refreshing session token and retrying once...`);
    try {
      const renewedToken = await tokenRefreshHandler(true);
      if (renewedToken) {
        console.log(`[API Client] Successfully renewed token. Retrying ${cleanEndpoint}...`);
        return await apiRequest<T>(endpoint, {
          ...options,
          token: renewedToken,
          _isRetry: true,
        });
      }
    } catch (refreshErr) {
      console.warn('[API Client] Reactive 401 refresh failed:', refreshErr);
    }
  }

  // Check if response is JSON
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json') || contentType.includes('application/problem+json');
  const data = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    console.warn(`[API Error ${response.status}] ${options.method || 'GET'} ${url}:`, JSON.stringify(data));
    if (isJson && data && typeof data === 'object') {
      const detailMsg = Array.isArray(data.detail)
        ? data.detail.map((d: any) => `${d.loc ? d.loc.filter((p: any) => p !== 'body').join('.') : 'field'}: ${d.msg}`).join(', ')
        : typeof data.detail === 'string'
        ? data.detail
        : undefined;

      if (data.code || data.title || detailMsg) {
        throw new ApiError({
          type: data.type || 'https://bharatpath.example/problems/http_error',
          title: data.title || detailMsg || `Server returned status ${response.status}`,
          status: response.status,
          code: data.code || `http_${response.status}`,
          params: data.params || { detail: data.detail },
        });
      }
    }

    throw new ApiError({
      type: 'https://bharatpath.example/problems/http_error',
      title: `Server returned status ${response.status}`,
      status: response.status,
      code: `http_${response.status}`,
    });
  }

  return data as T;
}
