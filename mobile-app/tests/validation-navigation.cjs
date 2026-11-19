/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const path = require('node:path');

// Exercise the screen's actual validation handler without requiring a native device.
const source = fs.readFileSync(path.join(__dirname, '../screens/auth/SignUpScreen.tsx'), 'utf8');
const ast = ts.createSourceFile('SignUpScreen.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let handler;
function find(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'validate') handler = node.initializer.getText(ast);
  ts.forEachChild(node, find);
}
find(ast);
assert.ok(handler, 'signup validation handler exists');
const compiled = ts.transpileModule(`exports.validate = ${handler}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

function validate(overrides = {}) {
  const calls = [];
  const ref = (key) => ({ current: { focus: () => calls.push(`focus:${key}`) } });
  const context = {
    exports: {}, readingResume: false,
    fullName: 'Test Candidate', email: 'test@example.com', phone: '+919876543210',
    currentCity: 'Pune', workStatus: 'FRESHER', password: 'Testing123', confirmPassword: 'Testing123',
    fullNameRef: ref('fullName'), emailRef: ref('email'), phoneRef: ref('phone'),
    currentCityRef: ref('currentCity'), passwordRef: ref('password'), confirmPasswordRef: ref('confirmPassword'),
    setErrorMsg: (message) => { if (message) calls.push(`error:${message}`); },
    setInvalidField: (key) => { if (key) calls.push(`invalid:${key}`); },
    requestAnimationFrame: (callback) => callback(),
    scrollToField: (key) => calls.push(`scroll:${key}`),
    ...overrides,
  };
  vm.runInNewContext(compiled, context);
  return { valid: context.exports.validate(), calls };
}

for (const [values, target] of [
  [{ fullName: '', currentCity: '' }, 'fullName'],
  [{ email: 'invalid' }, 'email'],
  [{ phone: '' }, 'phone'],
  [{ currentCity: '' }, 'currentCity'],
  [{ workStatus: '' }, 'workStatus'],
  [{ password: 'weak' }, 'password'],
  [{ confirmPassword: 'Different123' }, 'confirmPassword'],
]) {
  const result = validate(values);
  assert.equal(result.valid, false);
  assert.ok(result.calls.includes(`invalid:${target}`));
  assert.ok(result.calls.includes(`scroll:${target}`));
  if (target !== 'workStatus') assert.ok(result.calls.includes(`focus:${target}`));
}
assert.equal(validate().valid, true);
assert.deepEqual(validate().calls, []);
assert.ok(!source.includes('CANDIDATE SIGNUP'));
assert.ok(!source.includes('disabled={!isFormFilled'));
console.log('Signup errors navigate to the first invalid field; capsule removed.');

const careerSource = fs.readFileSync(path.join(__dirname, '../screens/profile/CareerDetailsScreen.tsx'), 'utf8');
const careerAst = ts.createSourceFile('CareerDetailsScreen.tsx', careerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let missingHandler;
function findMissing(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(careerAst) === 'focusMissingFields')
    missingHandler = node.initializer.getText(careerAst);
  ts.forEachChild(node, findMissing);
}
findMissing(careerAst);
const missingCompiled = ts.transpileModule(`exports.reveal = ${missingHandler}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
for (const [missing, mode, expectedStep, expectedTarget] of [
  [['full_name'], 'manual', 0, 'fullName'],
  [['phone'], 'manual', 1, 'phone'],
  [['qualification'], 'conversation', 2, 'conversation-answer'],
]) {
  let step, target;
  const fields = [
    { key: 'phone', section: 'basic', label: 'Phone' },
    { key: 'qualification', section: 'education', label: 'Qualification' },
  ];
  const context = {
    exports: {}, fields, draft: {}, onboarding: true, step: 3, onboardingMode: mode,
    groups: [{ key: 'basic' }, { key: 'employment' }, { key: 'education' }, { key: 'preferences' }],
    fieldVisible: () => true, conversationFieldsForStep: () => fields,
    setErrors() {}, setError() {}, setServerRequiresSkills() {}, setStepDone() {},
    setQuestionIndex() {}, setConversationHistory() {}, setConversationInput() {}, setAttempts() {}, setConversationError() {},
    setStep: (value) => { step = value; }, setInvalidTarget: (value) => { target = value.key; },
  };
  vm.runInNewContext(missingCompiled, context);
  assert.equal(context.exports.reveal(missing), true);
  assert.equal(step, expectedStep);
  assert.equal(target, expectedTarget);
}
console.log('Profile validation returns to the required step and targets its invalid field.');

let scrollHandler;
function findScroll(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(careerAst) === 'scrollToField')
    scrollHandler = node.initializer.getText(careerAst);
  ts.forEachChild(node, findScroll);
}
findScroll(careerAst);
const scrollCompiled = ts.transpileModule(`exports.scroll = ${scrollHandler}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const scrolls = [];
const scrollContext = {
  exports: {}, activeFieldKey: { current: null }, scrollOffset: { current: 400 },
  fieldOffsets: { current: { nested: 10 } },
  fieldViews: { current: { nested: { measureInWindow: (done) => done(0, 300, 200, 80) } } },
  scrollRef: { current: {
    getNativeScrollRef: () => ({ measureInWindow: (done) => done(0, 50, 400, 700) }),
    scrollTo: (position) => scrolls.push(position),
  } },
  setTimeout() {},
};
vm.runInNewContext(scrollCompiled, scrollContext);
scrollContext.exports.scroll('nested');
assert.equal(scrolls[0].y, 580, 'nested fields use their visible position relative to the scroll viewport');
assert.equal(scrolls[0].animated, true);
console.log('Nested profile fields scroll correctly from an existing scroll position.');
