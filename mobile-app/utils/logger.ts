import { Platform } from 'react-native';

export type LogLevel = 'STEP' | 'INFO' | 'WARN' | 'ERROR';

const SENSITIVE_KEYS = new Set([
  'password',
  'Password',
  'PreviousPassword',
  'ProposedPassword',
  'confirmPassword',
  'access_token',
  'accessToken',
  'AccessToken',
  'refresh_token',
  'refreshToken',
  'RefreshToken',
  'id_token',
  'idToken',
  'IdToken',
  'Authorization',
  'token',
]);

function timestamp(): string {
  const now = new Date();
  return now.toISOString().slice(11, 23); // HH:mm:ss.SSS
}

export function sanitizeForLog(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[MaxDepth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > 500 ? `${value.slice(0, 500)}... [truncated ${value.length} chars]` : value;
  }
  if (typeof value !== 'object') return value;

  if (typeof FormData !== 'undefined' && value instanceof FormData) {
    return '[FormData multipart payload]';
  }

  if (Array.isArray(value)) {
    if (value.length > 20) {
      return [...value.slice(0, 10).map((item) => sanitizeForLog(item, depth + 1)), `... (${value.length} items total)`];
    }
    return value.map((item) => sanitizeForLog(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(k)) {
      out[k] = typeof v === 'string' && v.length > 0 ? '[REDACTED]' : v;
    } else if (k === 'pages' && Array.isArray(v)) {
      out[k] = `[${v.length} base64 pages]`;
    } else {
      out[k] = sanitizeForLog(v, depth + 1);
    }
  }
  return out;
}

export function formatErrorForLog(err: unknown): Record<string, unknown> {
  if (!err) return { error: String(err) };
  if (typeof err === 'object') {
    const anyErr = err as Record<string, any>;
    return {
      name: anyErr.name || 'Error',
      message: anyErr.message || String(err),
      code: anyErr.code,
      status: anyErr.status,
      problem: anyErr.problem ? sanitizeForLog(anyErr.problem) : undefined,
      storageCode: anyErr.storageCode,
      stack: typeof anyErr.stack === 'string' ? anyErr.stack.split('\n').slice(0, 6).join('\n') : undefined,
    };
  }
  return { message: String(err) };
}

function formatDetails(details?: unknown): string {
  if (details === undefined) return '';
  try {
    const sanitized = sanitizeForLog(details);
    return typeof sanitized === 'string' ? ` | ${sanitized}` : ` | ${JSON.stringify(sanitized)}`;
  } catch {
    return ` | [Unserializable details]`;
  }
}

export const logger = {
  step(scope: string, action: string, details?: unknown) {
    console.log(`🟢 [${timestamp()}] [STEP] [${Platform.OS}] [${scope}] ${action}${formatDetails(details)}`);
  },

  info(scope: string, message: string, details?: unknown) {
    console.log(`🔵 [${timestamp()}] [INFO] [${Platform.OS}] [${scope}] ${message}${formatDetails(details)}`);
  },

  warn(scope: string, message: string, details?: unknown) {
    console.warn(`🟡 [${timestamp()}] [WARN] [${Platform.OS}] [${scope}] ${message}${formatDetails(details)}`);
  },

  error(scope: string, message: string, error?: unknown, extra?: unknown) {
    const payload = {
      ...(error !== undefined ? { error: formatErrorForLog(error) } : {}),
      ...(extra !== undefined ? { context: sanitizeForLog(extra) } : {}),
    };
    console.error(
      `🔴 [${timestamp()}] [ERROR] [${Platform.OS}] [${scope}] ${message}${
        Object.keys(payload).length > 0 ? formatDetails(payload) : ''
      }`
    );
  },
};

let globalHandlersInstalled = false;

export function installGlobalErrorLogger(): void {
  if (globalHandlersInstalled) return;
  globalHandlersInstalled = true;

  const g = globalThis as any;
  const errorUtils = g.ErrorUtils;
  if (errorUtils && typeof errorUtils.getGlobalHandler === 'function') {
    const previousHandler = errorUtils.getGlobalHandler();
    errorUtils.setGlobalHandler((error: any, isFatal?: boolean) => {
      logger.error(
        'GlobalErrorHandler',
        `Unhandled JS Exception (isFatal=${Boolean(isFatal)})`,
        error
      );
      if (typeof previousHandler === 'function') {
        previousHandler(error, isFatal);
      }
    });
  }
}

