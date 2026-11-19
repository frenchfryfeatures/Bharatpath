import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { fetch as expoFetch } from 'expo/fetch';
import { logger, sanitizeForLog } from '@/utils/logger';
import { httpErrorMessage, validationErrorMessage } from './errorMessages';

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
  responseType?: 'arrayBuffer';
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

  const controller = new AbortController();
  fetchOptions.signal = controller.signal;
  const timeout = setTimeout(
    () => controller.abort(),
    options.body instanceof FormData ? 120_000 : 30_000,
  );

  if (options.body) {
    fetchOptions.body =
      options.body instanceof FormData ? options.body : JSON.stringify(options.body);
  }

  const method = options.method || 'GET';
  const startedAt = Date.now();
  let response: Response;
  try {
    logger.info(
      'API',
      `--> ${method} ${cleanEndpoint} [${requestId}]`,
      {
        url,
        hasAuth: Boolean(token),
        isRetry: Boolean(options._isRetry),
        body: options.body ? sanitizeForLog(options.body) : undefined,
      },
    );
    response =
      Platform.OS !== 'web' && options.body instanceof FormData
        ? ((await expoFetch(
            url,
            fetchOptions as unknown as Parameters<typeof expoFetch>[1],
          )) as unknown as Response)
        : await fetch(url, fetchOptions);
  } catch (netErr: any) {
    const durationMs = Date.now() - startedAt;
    logger.error(
      'API',
      `<-- NETWORK FAILURE ${method} ${cleanEndpoint} [${requestId}] (${durationMs}ms)`,
      netErr,
      { url, timedOut: controller.signal.aborted },
    );
    throw new ApiError({
      type: 'https://bharatpath.example/problems/network_error',
      title: controller.signal.aborted
        ? 'The request timed out. Check your connection and try again.'
        : 'Cannot reach the service. Check your connection and try again.',
      status: 0,
      code: controller.signal.aborted ? 'request_timeout' : 'network_error',
    });
  } finally {
    clearTimeout(timeout);
  }

  // 2. Reactive 401 handling: If server returns 401 Unauthorized (e.g. invalid/expired token),
  // silently refresh via Cognito refresh token and retry the request once.
  if (response.status === 401 && !options._isRetry && !options.skipAuthRefresh && tokenRefreshHandler) {
    logger.warn('API', `401 Unauthorized on ${method} ${cleanEndpoint} [${requestId}] — attempting token refresh & retry`);
    try {
      const renewedToken = await tokenRefreshHandler(true);
      if (renewedToken) {
        logger.info('API', `Token refreshed successfully. Retrying ${method} ${cleanEndpoint}`);
        return await apiRequest<T>(endpoint, {
          ...options,
          token: renewedToken,
          _isRetry: true,
        });
      }
    } catch (refreshErr) {
      logger.error('API', `Reactive 401 token refresh failed on ${cleanEndpoint}`, refreshErr);
    }
  }

  // Check if response is JSON
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json') || contentType.includes('application/problem+json');
  let data: any;
  try {
    data = response.ok && options.responseType === 'arrayBuffer'
      ? await response.arrayBuffer()
      : isJson ? await response.json() : await response.text();
  } catch (parseErr) {
    const durationMs = Date.now() - startedAt;
    logger.error(
      'API',
      `<-- UNREADABLE RESPONSE ${response.status} ${method} ${cleanEndpoint} [${requestId}] (${durationMs}ms)`,
      parseErr,
      { contentType },
    );
    throw new ApiError({
      type: 'https://bharatpath.example/problems/invalid_response',
      title: 'The service returned an unreadable response. Please try again.',
      status: response.status,
      code: 'invalid_response',
    });
  }

  const durationMs = Date.now() - startedAt;

  if (!response.ok) {
    const isExpectedBusinessState =
      response.status === 402 ||
      (response.status === 404 && cleanEndpoint.includes('/profile/photo'));
    if (isExpectedBusinessState) {
      logger.warn(
        'API',
        `<-- HTTP ${response.status} ${method} ${cleanEndpoint} [${requestId}] (${durationMs}ms)`,
        {
          status: response.status,
          contentType,
          response: sanitizeForLog(data),
        },
      );
    } else {
      logger.error(
        'API',
        `<-- HTTP ${response.status} ${method} ${cleanEndpoint} [${requestId}] (${durationMs}ms)`,
        undefined,
        {
          status: response.status,
          contentType,
          response: sanitizeForLog(data),
        },
      );
    }
    if (isJson && data && typeof data === 'object') {
      const detailMsg = Array.isArray(data.detail)
        ? validationErrorMessage(data.detail)
        : typeof data.detail === 'string'
        ? httpErrorMessage(response.status)
        : undefined;

      if (data.code || data.title || detailMsg) {
        throw new ApiError({
          type: data.type || 'https://bharatpath.example/problems/http_error',
          title: detailMsg || data.title || httpErrorMessage(response.status),
          status: response.status,
          code: data.code || `http_${response.status}`,
          params: data.params || { detail: data.detail },
        });
      }
    }

    throw new ApiError({
      type: 'https://bharatpath.example/problems/http_error',
      title: httpErrorMessage(response.status),
      status: response.status,
      code: `http_${response.status}`,
    });
  }

  logger.info(
    'API',
    `<-- HTTP ${response.status} ${method} ${cleanEndpoint} [${requestId}] (${durationMs}ms)`,
    sanitizeForLog(data),
  );

  return data as T;
}
