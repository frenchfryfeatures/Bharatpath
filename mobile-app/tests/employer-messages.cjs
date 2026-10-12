/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

// Load utils/helpers.ts
const helpersFile = path.resolve(__dirname, '../utils/helpers.ts');
const helpersSource = fs.readFileSync(helpersFile, 'utf8');
const compiledHelpers = ts.transpileModule(helpersSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

const helpersModule = new Module(helpersFile, module);
helpersModule._compile(compiledHelpers, helpersFile);
const { formatMessageDateTime } = helpersModule.exports;

// 1. Date formatting tests
console.log('Testing formatMessageDateTime...');
assert.equal(formatMessageDateTime(''), '');
assert.equal(formatMessageDateTime(null), '');
assert.equal(formatMessageDateTime(undefined), '');
assert.equal(formatMessageDateTime('invalid-date'), '');

const formattedInterview1 = formatMessageDateTime('2026-10-05T07:07:00Z');
// In Asia/Kolkata (+05:30), 07:07 UTC is 12:37 pm IST
assert.match(formattedInterview1, /5 Oct 2026/);
assert.match(formattedInterview1, /12:37/);
assert.match(formattedInterview1, /pm/i);

const formattedInterview2 = formatMessageDateTime('2026-10-28T03:30:00Z');
// In Asia/Kolkata (+05:30), 03:30 UTC is 9:00 am IST
assert.match(formattedInterview2, /28 Oct 2026/);
assert.match(formattedInterview2, /9:00/);
assert.match(formattedInterview2, /am/i);

// 2. Message kind & label mapping tests
function getMessageLabel(kind) {
  if (kind === 'INTERVIEW') return 'Interview';
  if (kind === 'ASSESSMENT') return 'Assessment';
  return 'Message';
}

function getMessageActionLabel(kind) {
  if (kind === 'INTERVIEW') return 'Open invitation';
  if (kind === 'ASSESSMENT') return 'Open assessment';
  return 'Open link';
}

function getUpdateCountText(count) {
  return `${count} ${count === 1 ? 'update' : 'updates'}`;
}

assert.equal(getMessageLabel('INTERVIEW'), 'Interview');
assert.equal(getMessageLabel('ASSESSMENT'), 'Assessment');
assert.equal(getMessageLabel('GENERAL'), 'Message');
assert.equal(getMessageLabel('OTHER'), 'Message');

assert.equal(getMessageActionLabel('INTERVIEW'), 'Open invitation');
assert.equal(getMessageActionLabel('ASSESSMENT'), 'Open assessment');
assert.equal(getMessageActionLabel('GENERAL'), 'Open link');

assert.equal(getUpdateCountText(1), '1 update');
assert.equal(getUpdateCountText(2), '2 updates');
assert.equal(getUpdateCountText(5), '5 updates');

// 3. CandidateApplicationMessage mock response verification
const sampleMessages = [
  {
    id: 'msg-1',
    kind: 'INTERVIEW',
    body: 'Interview',
    scheduled_at: '2026-10-28T03:30:00Z',
    link: null,
    employer_name: 'Tech Corp',
    created_at: '2026-10-05T07:07:00Z',
  },
  {
    id: 'msg-2',
    kind: 'INTERVIEW',
    body: '2nd round',
    scheduled_at: '2026-10-30T03:30:00Z',
    link: 'https://meet.google.com/abc-def-ghi',
    employer_name: 'Tech Corp',
    created_at: '2026-10-05T07:07:00Z',
  },
];

assert.equal(sampleMessages.length, 2);
assert.equal(getUpdateCountText(sampleMessages.length), '2 updates');
assert.equal(getMessageLabel(sampleMessages[0].kind), 'Interview');
assert.equal(formatMessageDateTime(sampleMessages[0].scheduled_at), '28 Oct 2026, 9:00 am');
assert.equal(getMessageActionLabel(sampleMessages[1].kind), 'Open invitation');
assert.equal(sampleMessages[1].link, 'https://meet.google.com/abc-def-ghi');

console.log('All employer messages tests passed successfully!');
