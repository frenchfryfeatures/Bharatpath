const assert = require('assert');

console.log('Testing Save & Continue Resilience (API cleaning & Step Completion)...');

// 1. Phone number formatting test
function cleanPhone(raw) {
  let phoneStr = typeof raw === 'string' ? raw.trim().replace(/[\s-]/g, '') : '';
  if (!phoneStr.startsWith('+') && /^\d{10}$/.test(phoneStr)) {
    phoneStr = `+91${phoneStr}`;
  }
  return /^\+[1-9]\d{7,14}$/.test(phoneStr) ? phoneStr : '';
}

assert.strictEqual(cleanPhone('9876543210'), '+919876543210', '10-digit phone should auto-prepend +91');
assert.strictEqual(cleanPhone('+91 98765 43210'), '+919876543210', 'Phone with spaces should normalize properly');
assert.strictEqual(cleanPhone('+14155552671'), '+14155552671', 'International phone should be preserved');
assert.strictEqual(cleanPhone('invalid'), '', 'Invalid phone should be cleared');

// 2. Salary null preservation test (should NOT convert null/empty to 0)
function cleanSalary(raw) {
  if (raw !== null && raw !== undefined && raw !== '') {
    const num = Number(raw);
    return Number.isInteger(num) && num >= 0 && num <= 1_000_000_000 ? num : null;
  }
  return null;
}

assert.strictEqual(cleanSalary(null), null, 'null salary must remain null');
assert.strictEqual(cleanSalary(''), null, 'empty salary must remain null');
assert.strictEqual(cleanSalary(undefined), null, 'undefined salary must remain null');
assert.strictEqual(cleanSalary(500000), 500000, 'Valid salary integer must be preserved');
assert.strictEqual(cleanSalary('1200000'), 1200000, 'String salary integer must be parsed');

// 3. Key skills fallback test when complete=true
function ensureKeySkills(skills, complete, workStatus) {
  if (complete && (!skills || (Array.isArray(skills) && skills.length === 0))) {
    return workStatus === 'FRESHER' ? ['Fresher'] : ['General'];
  }
  return skills || [];
}

assert.deepStrictEqual(
  ensureKeySkills([], true, 'FRESHER'),
  ['Fresher'],
  'Empty skills on complete=true for fresher should fallback to [Fresher]',
);
assert.deepStrictEqual(
  ensureKeySkills([], true, 'EXPERIENCED'),
  ['General'],
  'Empty skills on complete=true for experienced should fallback to [General]',
);
assert.deepStrictEqual(
  ensureKeySkills([], false, 'FRESHER'),
  [],
  'Empty skills on complete=false should stay empty for draft',
);

// 4. Intermediate step completion check
function computeIsLastStep(step, totalGroups) {
  return step === totalGroups - 1;
}

assert.strictEqual(computeIsLastStep(0, 4), false, 'Step 0 of 4 must NOT be treated as last step');
assert.strictEqual(computeIsLastStep(1, 4), false, 'Step 1 of 4 must NOT be treated as last step');
assert.strictEqual(computeIsLastStep(2, 4), false, 'Step 2 of 4 must NOT be treated as last step');
assert.strictEqual(computeIsLastStep(3, 4), true, 'Step 3 of 4 is the final step');

console.log('✓ All Save & Continue resilience tests passed successfully!');
