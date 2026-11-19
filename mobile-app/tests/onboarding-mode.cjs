/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../services/storage/onboardingMode.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const stored = new Map();
function restart(storage = {
  getItem: async (key) => stored.get(key) ?? null,
  setItem: async (key, value) => { stored.set(key, value); },
}) {
  const context = { exports: {}, require: () => ({ __esModule: true, default: storage }) };
  vm.runInNewContext(compiled, context);
  return context.exports;
}
async function main() {
  let api = restart();
  const ready = { onboarding: true, editing: true, step: 1, restored: true, mode: null, basicComplete: true, completed: false };
  assert.equal(api.shouldOfferOnboardingMode(ready), true);
  for (const override of [{ step: 0 }, { basicComplete: false }, { restored: false }, { mode: 'manual' },
    { mode: 'conversation' }, { completed: true }, { onboarding: false }]) {
    assert.equal(api.shouldOfferOnboardingMode({ ...ready, ...override }), false);
  }
  await api.saveOnboardingMode('account-a', 'conversation');
  api = restart(); // Simulate an app restart: only persistent storage remains.
  assert.equal(await api.getOnboardingMode('account-a'), 'conversation');
  assert.equal(await api.getOnboardingMode('account-b'), null);
  assert.equal(api.shouldOfferOnboardingMode({ ...ready, mode: await api.getOnboardingMode('account-a') }), false);
  await api.saveOnboardingMode('account-a', 'manual');
  assert.equal(await restart().getOnboardingMode('account-a'), 'manual');
  const failing = restart({ getItem: async () => { throw new Error('offline storage'); }, setItem: async () => { throw new Error('offline storage'); } });
  await failing.saveOnboardingMode('account-c', 'manual');
  assert.equal(await failing.getOnboardingMode('account-c'), 'manual');
  console.log('Mode selection waits for step 1, survives restarts, and stays isolated per account.');
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
