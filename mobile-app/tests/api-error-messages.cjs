/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, dependencies = {}, globals = {}) {
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {}, require: (name) => dependencies[name] ?? {}, ...globals };
  vm.runInNewContext(code, context);
  return context.exports;
}
const messages = load('services/api/errorMessages.ts');
const rejected = [{ loc: ['body', 'details', 'annual_salary_currency'], type: 'extra_forbidden', msg: 'Extra inputs are not permitted' }];
assert.match(messages.validationErrorMessage(rejected), /service needs an update/);
assert.doesNotMatch(messages.validationErrorMessage(rejected), /annual_salary_currency|Extra inputs|details\./);
assert.equal(messages.validationErrorMessage([{ loc: ['body', 'details', 'notice_period'], type: 'missing' }]), 'Please enter your notice period.');
assert.equal(messages.validationErrorMessage([{ loc: ['body', 'details', 'phone'], type: 'value_error', msg: 'internal technical text' }]), 'Please check your mobile number and try again.');
const client = load('services/api/client.ts', {
  'react-native': { Platform: { OS: 'web' } },
  'expo-constants': { __esModule: true, default: {} },
  './errorMessages': messages,
  '@/utils/logger': { logger: { info() {}, warn() {}, error() {} }, sanitizeForLog: (value) => value },
}, {
  process: { env: { EXPO_PUBLIC_API_BASE_URL: 'http://test.invalid/api/v1' } },
  AbortController, FormData, setTimeout, clearTimeout,
  fetch: async () => new Response(JSON.stringify({ detail: rejected }), { status: 422, headers: { 'content-type': 'application/json' } }),
});
async function main() {
  await assert.rejects(client.apiRequest('/candidate/profile/details', { method: 'PUT', body: { details: { annual_salary_currency: 'USD' } } }),
    (error) => error instanceof client.ApiError && error.status === 422 && /service needs an update/.test(error.message) &&
      !error.message.includes('annual_salary_currency') && error.problem.params.detail[0].type === 'extra_forbidden');
  console.log('API validation errors use natural language and preserve technical details only as metadata.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
