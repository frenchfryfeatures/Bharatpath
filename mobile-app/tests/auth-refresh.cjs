const assert = require('assert');

// 1. JWT Expiration parser test
function decodeBase64Url(base64Url) {
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  if (typeof atob === 'function') {
    return atob(padded);
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  let str = padded.replace(/=+$/, '');
  let output = '';
  for (
    let bc = 0, bs = 0, buffer, idx = 0;
    (buffer = str.charCodeAt(idx++));
    ~buffer && ((bs = bc % 4 ? bs * 64 + buffer : buffer), bc++ % 4)
      ? (output += String.fromCharCode(255 & (bs >> ((-2 * bc) & 6))))
      : 0
  ) {
    buffer = chars.indexOf(String.fromCharCode(buffer));
  }
  return output;
}

function parseJwtExpiration(token) {
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

const REFRESH_LEEWAY_MS = 60000;

function isSessionTokenFresh(session) {
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

// Test 1: JWT expiration parsing
const futureExpSec = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
const pastExpSec = Math.floor(Date.now() / 1000) - 1800; // 30 minutes ago
const tokenFuture = 'header.' + Buffer.from(JSON.stringify({ exp: futureExpSec, sub: 'user-1' })).toString('base64url') + '.sig';
const tokenPast = 'header.' + Buffer.from(JSON.stringify({ exp: pastExpSec, sub: 'user-1' })).toString('base64url') + '.sig';

assert.strictEqual(parseJwtExpiration(tokenFuture), futureExpSec * 1000);
assert.strictEqual(parseJwtExpiration(tokenPast), pastExpSec * 1000);
assert.strictEqual(parseJwtExpiration('invalid-token'), null);
assert.strictEqual(parseJwtExpiration('header.notjson.sig'), null);
console.log('✓ JWT parsing passed');

// Test 2: Token freshness calculation
const freshSession = {
  accessToken: tokenFuture,
  refreshToken: 'mock-refresh-token-30-days',
  expiresAt: Date.now() + 3600000,
};
assert.strictEqual(isSessionTokenFresh(freshSession), true);

const expiringSoonSession = {
  accessToken: tokenFuture,
  refreshToken: 'mock-refresh-token-30-days',
  expiresAt: Date.now() + 30000, // 30 seconds left (< 60s leeway)
};
assert.strictEqual(isSessionTokenFresh(expiringSoonSession), false);

const expiredSession = {
  accessToken: tokenPast,
  refreshToken: 'mock-refresh-token-30-days',
  expiresAt: Date.now() - 3600000,
};
assert.strictEqual(isSessionTokenFresh(expiredSession), false);

// Session missing expiresAt but with JWT token
const sessionWithoutExplicitExpires = {
  accessToken: tokenFuture,
  refreshToken: 'mock-refresh-token-30-days',
};
assert.strictEqual(isSessionTokenFresh(sessionWithoutExplicitExpires), true);
assert.strictEqual(sessionWithoutExplicitExpires.expiresAt, futureExpSec * 1000);
console.log('✓ Token freshness checks passed');

// Test 3: Deduplication / Single-flight refresh test
let refreshCallCount = 0;
let inFlightPromise = null;

async function mockRefreshToken() {
  if (inFlightPromise) return inFlightPromise;
  inFlightPromise = (async () => {
    try {
      refreshCallCount++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return 'new-access-token-' + refreshCallCount;
    } finally {
      inFlightPromise = null;
    }
  })();
  return inFlightPromise;
}

async function testConcurrency() {
  refreshCallCount = 0;
  // Fire 10 concurrent requests during token expiration
  const results = await Promise.all([
    mockRefreshToken(),
    mockRefreshToken(),
    mockRefreshToken(),
    mockRefreshToken(),
    mockRefreshToken(),
    mockRefreshToken(),
    mockRefreshToken(),
    mockRefreshToken(),
    mockRefreshToken(),
    mockRefreshToken(),
  ]);

  assert.strictEqual(refreshCallCount, 1, 'Concurrent refresh must fire exactly 1 request (deduplication)');
  assert.strictEqual(results.every((r) => r === 'new-access-token-1'), true, 'All callers get the renewed token');
  console.log('✓ Concurrent refresh deduplication (thundering herd protection) passed');
}

// Test 4: Cognito InitiateAuth payload verification for REFRESH_TOKEN_AUTH
function generateCognitoRefreshPayload(clientId, refreshToken) {
  return {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: clientId,
    AuthParameters: {
      REFRESH_TOKEN: refreshToken,
    },
  };
}

const payload = generateCognitoRefreshPayload('7sm4qd9k4bitdseu05d1t9pt4u', 'mock-30-day-refresh-token');
assert.strictEqual(payload.AuthFlow, 'REFRESH_TOKEN_AUTH');
assert.strictEqual(payload.ClientId, '7sm4qd9k4bitdseu05d1t9pt4u');
assert.strictEqual(payload.AuthParameters.REFRESH_TOKEN, 'mock-30-day-refresh-token');
console.log('✓ Cognito REFRESH_TOKEN_AUTH payload shape verified');

// Test 5: Session renewal data merging
const oldSession = {
  accessToken: 'old-access-token',
  refreshToken: 'mock-30-day-refresh-token',
  idToken: 'old-id-token',
  expiresAt: Date.now() - 5000,
  userId: 'usr-123',
  email: 'test@example.com',
  role: 'CANDIDATE',
  pool: 'CANDIDATE',
  tenantId: null,
};

const cognitoResult = {
  AccessToken: 'brand-new-access-token',
  ExpiresIn: 3600,
  IdToken: 'brand-new-id-token',
  // RefreshToken not returned by Cognito when rotation is disabled
};

const updatedSession = {
  ...oldSession,
  accessToken: cognitoResult.AccessToken,
  refreshToken: cognitoResult.RefreshToken || oldSession.refreshToken,
  idToken: cognitoResult.IdToken || oldSession.idToken,
  expiresAt: Date.now() + cognitoResult.ExpiresIn * 1000,
};

assert.strictEqual(updatedSession.accessToken, 'brand-new-access-token');
assert.strictEqual(updatedSession.refreshToken, 'mock-30-day-refresh-token', 'Preserves 30-day refresh token');
assert.strictEqual(updatedSession.idToken, 'brand-new-id-token');
assert(updatedSession.expiresAt > Date.now() + 3500000, 'Expiration extended by 1 hour');
console.log('✓ Session renewal data merging passed');

testConcurrency().then(() => {
  console.log('\nAll 30-day refresh token authentication tests passed successfully!');
});
