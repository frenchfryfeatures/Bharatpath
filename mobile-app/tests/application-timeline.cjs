// "Where things stand" shows only what happened (2026-11-23): a withdrawal
// straight after applying is not five ticks.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
function load(file, imports = {}) {
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true},
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, {exports, require: name => {
    assert.ok(name in imports, `Unexpected import ${name}`); return imports[name];
  }, console, Set, Date, Math, Number});
  return exports;
}
const application = load('types/application.ts');
const {buildTimeline} = load('utils/applicationTimeline.ts', {'@/types/application': application});
const ev = (from, to, at = '2026-11-20T10:00:00Z') => ({kind: 'STAGE_CHANGED', from_stage: from, to_stage: to, by: 'CANDIDATE', occurred_at: at});
const view = (items) => JSON.parse(JSON.stringify(items.map((i) => `${i.label}:${i.state}`)));

// Withdrawn right after applying.
assert.deepEqual(view(buildTimeline([ev(null, 'SUBMITTED'), ev('SUBMITTED', 'WITHDRAWN')], 'WITHDRAWN')),
  ['Application sent:done', 'Withdrawn by you:ended']);
// Withdrawn with no history at all still shows the application was sent.
assert.deepEqual(view(buildTimeline([], 'WITHDRAWN')), ['Application sent:done', 'Withdrawn by you:ended']);
// Withdrawn after being shortlisted.
assert.deepEqual(view(buildTimeline([ev(null, 'SUBMITTED'), ev('SUBMITTED', 'VIEWED'), ev('VIEWED', 'SHORTLISTED'), ev('SHORTLISTED', 'WITHDRAWN')], 'WITHDRAWN')),
  ['Application sent:done', 'Profile opened by employer:done', 'Shortlisted:done', 'Withdrawn by you:ended']);
// Rejected after the profile was opened.
assert.deepEqual(view(buildTimeline([ev(null, 'SUBMITTED'), ev('SUBMITTED', 'VIEWED'), ev('VIEWED', 'REJECTED')], 'REJECTED')),
  ['Application sent:done', 'Profile opened by employer:done', 'Not selected:ended']);
// Rejected after the interview: the from_stage counts as reached.
assert.deepEqual(view(buildTimeline([ev('INTERVIEW', 'REJECTED')], 'REJECTED')),
  ['Application sent:done', 'Profile opened by employer:done', 'Shortlisted:done', 'Interview:done', 'Not selected:ended']);
// Expired untouched.
assert.deepEqual(view(buildTimeline([ev(null, 'SUBMITTED'), ev('SUBMITTED', 'EXPIRED')], 'EXPIRED')),
  ['Application sent:done', 'Closed with no response:ended']);
// Hired completes every stage.
const hired = buildTimeline([ev('DECISION', 'HIRED')], 'HIRED');
assert.ok(hired.every((i) => i.state === 'done') && hired.length === 5);
assert.match(hired[4].sub, /^Hired/);
// Open applications: done before, current, then pending.
assert.deepEqual(view(buildTimeline([], 'SUBMITTED')),
  ['Application sent:current', 'Profile opened by employer:pending', 'Shortlisted:pending', 'Interview:pending', 'Decision:pending']);
assert.deepEqual(view(buildTimeline([], 'INTERVIEW')),
  ['Application sent:done', 'Profile opened by employer:done', 'Shortlisted:done', 'Interview:current', 'Decision:pending']);
console.log('application-timeline ok');
