import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadSource(path, imports = {}, globals = {}) {
  const source = fs.readFileSync(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = {
    exports: {}, atob, process: { env: {} }, ...globals,
    require(name) {
      if (!(name in imports)) throw new Error(`Unexpected import: ${name}`);
      return imports[name];
    },
  };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

const { ApiError } = loadSource("../lib/api/errors.ts");
const backendAuth = loadSource("../lib/auth/backend-auth.ts");
const tokenFor = (pool) => `header.${Buffer.from(JSON.stringify({
  iss: `https://cognito-idp.ap-south-1.amazonaws.com/${pool}`,
})).toString("base64url")}.signature`;
const candidateToken = tokenFor("candidate-pool");
const businessToken = tokenFor("business-pool");
const { poolOfToken } = loadSource("../lib/auth/refresh-session.ts", {
  "aws-amplify/auth": {},
  "@/lib/auth/cognito": { COGNITO_CONFIG: { candidatePoolId: "candidate-pool", businessPoolId: "business-pool" } },
  "@/lib/auth/token": {},
  "@/lib/auth/token-expiration": {},
});

function sessionService(token, responses, renewedToken = token) {
  return loadSource("../features/auth/services/auth.service.ts", {
    "@/lib/api/errors": { ApiError },
    "@/lib/auth/backend-auth": backendAuth,
    "@/lib/auth/handle-session-expired": {},
    "@/lib/auth/cognito": {},
    "@/lib/auth/refresh-session": {
      getFreshToken: async () => token,
      poolOfToken,
      refreshSession: async () => ({ status: "OK", token: renewedToken }),
    },
    "@/lib/auth/token": { setStoredToken() {} },
    "@/lib/auth/session": {},
  }, {
    fetch: async () => {
      const next = responses.shift();
      assert.ok(next, "unexpected extra backend call");
      return new Response(JSON.stringify(next.body), { status: next.status });
    },
  }).authService;
}

const noMembership = () => ({ status: 403, body: { code: "no_active_membership" } });

test("business session hydration preserves organisation onboarding instead of becoming a student", async () => {
  const result = await sessionService(businessToken, [noMembership()]).me();
  assert.equal(result.user.role, "EMPLOYER");
  assert.equal(result.path, "/employer");
  assert.equal(result.backendRole, "NO_ACTIVE_MEMBERSHIP");
});

test("a forbidden candidate session is rejected rather than sent to student signup", async () => {
  await assert.rejects(sessionService(candidateToken, [noMembership()]).me(),
    (error) => error instanceof ApiError && error.code === "no_active_membership");
});

test("business pool-role mismatches are not treated as onboarding", async () => {
  await assert.rejects(sessionService(businessToken, [
    { status: 403, body: { code: "pool_role_mismatch" } },
  ]).me(), (error) => error instanceof ApiError && error.code === "pool_role_mismatch");
});

test("renewed business tokens retain their pool", async () => {
  const result = await sessionService(businessToken, [
    { status: 401, body: { code: "invalid_token" } }, noMembership(),
  ]).me();
  assert.equal(result.user.role, "EMPLOYER");
});

for (const [role, path] of [
  ["PLATFORM_ADMIN", "/admin"], ["EMPLOYER_OWNER", "/employer"],
  ["COLLEGE_ADMIN", "/college"], ["CANDIDATE", "/student"],
]) {
  test(`a backend ${role} membership selects ${path}`, async () => {
    const result = await sessionService(role === "CANDIDATE" ? candidateToken : businessToken, [
      { status: 200, body: { user_id: "test-user", role } },
    ]).me();
    assert.equal(result.path, path);
    assert.equal(result.backendRole, role);
  });
}
