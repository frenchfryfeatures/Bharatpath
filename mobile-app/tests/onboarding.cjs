/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Exercise the pure policy/state rules used by the React Native screens.
const filename = path.resolve(__dirname, '../services/profile/onboarding.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const loaded = new Module(filename, module);
loaded._compile(compiled, filename);
const { passwordRequirements, onboardingDestination } = loaded.exports;

assert.equal(passwordRequirements('Ashort1').filter((rule) => rule.met).length, 3);
assert.equal(passwordRequirements('OnlyLettersHere').find((rule) => rule.label === 'A number').met, false);
assert.ok(passwordRequirements('StrongPassword12').every((rule) => rule.met), 'symbols are optional');
assert.ok(passwordRequirements('').every((rule) => !rule.met));

const completed = { completed: true, resume_version_id: 'current' };
const latest = { resume_version_id: 'current', confirmed: false };
assert.equal(onboardingDestination(completed, latest), 'subscribe', 'completed profiles resume at membership');
assert.equal(onboardingDestination({ ...completed, completed: false }, latest), 'review');
assert.equal(onboardingDestination(completed, { ...latest, resume_version_id: 'replacement' }), 'review');
assert.equal(onboardingDestination(completed, { ...latest, confirmed: true }), 'home');
assert.equal(onboardingDestination(completed), 'review', 'resume-less accounts begin with Basic details');
console.log('Mobile onboarding policy and resume routing checks passed.');
