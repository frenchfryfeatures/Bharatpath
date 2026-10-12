/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(
  __dirname,
  '../services/api/college.ts',
);
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

const loaded = new Module(filename, module);
loaded.require = function (id) {
  if (id === './client') {
    return { apiRequest: async () => {} };
  }
  return Module._load(id, loaded);
};
loaded._compile(compiled, filename);
const {
  consolidateCollegeLinks,
  collegeMonogram,
  daysUntilExpiry,
} = loaded.exports;

// 1. Monogram tests
console.log('Testing collegeMonogram...');
assert.equal(collegeMonogram('Delhi University'), 'DU');
assert.equal(collegeMonogram('Indian Institute of Technology'), 'II');
assert.equal(collegeMonogram('College'), 'C');
assert.equal(collegeMonogram(''), 'C');
assert.equal(collegeMonogram('   '), 'C');

// 2. daysUntilExpiry tests
console.log('Testing daysUntilExpiry...');
const future = new Date(Date.now() + 5 * 86_400_000).toISOString();
assert.equal(daysUntilExpiry(future), 5);

const past = new Date(Date.now() - 2 * 86_400_000).toISOString();
assert.ok(daysUntilExpiry(past) <= 0);

// 3. consolidateCollegeLinks tests
console.log('Testing consolidateCollegeLinks...');
const mockLinks = [
  {
    college_id: 'col-1',
    college_name: 'IIT Delhi',
    scope: 'ROSTER',
    granted_via: 'REFERRAL_CODE',
    granted_at: '2026-09-01T10:00:00Z',
    revoked_at: null,
    seat_held: false,
  },
  {
    college_id: 'col-1',
    college_name: 'IIT Delhi',
    scope: 'INDIVIDUAL',
    granted_via: 'REFERRAL_CODE',
    granted_at: '2026-09-05T10:00:00Z',
    revoked_at: null,
    seat_held: true,
  },
  {
    college_id: 'col-2',
    college_name: 'BITS Pilani',
    scope: 'ROSTER',
    granted_via: 'INVITATION',
    granted_at: '2026-09-10T10:00:00Z',
    revoked_at: '2026-09-12T10:00:00Z', // revoked
    seat_held: false,
  },
  {
    college_id: 'col-3',
    college_name: 'DTU',
    scope: 'ROSTER',
    granted_via: 'REFERRAL_CODE',
    granted_at: '2026-09-15T10:00:00Z',
    revoked_at: null,
    seat_held: false,
  },
];

const consolidated = consolidateCollegeLinks(mockLinks);
assert.equal(consolidated.length, 2);

const iit = consolidated.find((c) => c.collegeId === 'col-1');
assert.ok(iit);
assert.equal(iit.name, 'IIT Delhi');
assert.equal(iit.byName, true);
assert.equal(iit.seatHeld, true);
assert.equal(iit.since, '2026-09-01T10:00:00Z');

const dtu = consolidated.find((c) => c.collegeId === 'col-3');
assert.ok(dtu);
assert.equal(dtu.name, 'DTU');
assert.equal(dtu.byName, false);
assert.equal(dtu.seatHeld, false);

// col-2 was revoked, should not be included
assert.equal(consolidated.some((c) => c.collegeId === 'col-2'), false);

// Empty or null input
assert.deepEqual(consolidateCollegeLinks([]), []);
assert.deepEqual(consolidateCollegeLinks(null), []);
assert.deepEqual(consolidateCollegeLinks(undefined), []);

// 4. Code formatting helper logic test
function formatCrockfordCode(raw) {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  const p1 = clean.slice(0, 4);
  const p2 = clean.slice(4, 8);
  const p3 = clean.slice(8, 12);
  return [p1, p2, p3].filter(Boolean).join('-');
}

assert.equal(formatCrockfordCode('abcd1234efgh'), 'ABCD-1234-EFGH');
assert.equal(formatCrockfordCode('abcd-1234-efgh'), 'ABCD-1234-EFGH');
assert.equal(formatCrockfordCode('abcd 1234!efgh'), 'ABCD-1234-EFGH');
assert.equal(formatCrockfordCode('abcd12'), 'ABCD-12');
assert.equal(formatCrockfordCode('abcd'), 'ABCD');

console.log('All college service and consolidation tests passed successfully!');
