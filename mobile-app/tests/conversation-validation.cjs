const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

console.log('Testing Conversational Intake Validation (Salary & Date Rules)...');

const filename = path.resolve(__dirname, '../screens/onboarding/conversationValidation.ts');
const source = fs.readFileSync(filename, 'utf8')
  .replace(/^import type .*;$/gm, '')
  .replace(/^import .*;$/gm, '');

const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

const virtualFilename = path.resolve(__dirname, '../screens/onboarding/conversationValidation.transpiled.js');
const loaded = new Module(virtualFilename, module);
loaded._compile(transpiled, virtualFilename);

const {
  parseConversationAnswer,
  parseSalaryInput,
  parseMonthInput,
  formatSalaryDisplay,
} = loaded.exports;

// ─── 1. SALARY PARSING TESTS ──────────────────────────────────
console.log('1. Testing Salary Parsing (LPA, Cr, K, Per Month, Raw)...');

// LPA formats
assert.equal(parseSalaryInput('77LPA').value, 7_700_000, '77LPA should be 77 Lakhs');
assert.equal(parseSalaryInput('77 LPA').value, 7_700_000, '77 LPA should be 77 Lakhs');
assert.equal(parseSalaryInput('12 lpa').value, 1_200_000, '12 lpa should be 12 Lakhs');
assert.equal(parseSalaryInput('6.5 LPA').value, 650_000, '6.5 LPA should be 6.5 Lakhs');
assert.equal(parseSalaryInput('12 Lakhs').value, 1_200_000, '12 Lakhs should be 12 Lakhs');
assert.equal(parseSalaryInput('12 lac').value, 1_200_000, '12 lac should be 12 Lakhs');
assert.equal(parseSalaryInput('12 L').value, 1_200_000, '12 L should be 12 Lakhs');

// Crores
assert.equal(parseSalaryInput('1.5 Cr').value, 15_000_000, '1.5 Cr should be 1.5 Crores');
assert.equal(parseSalaryInput('1.5cr').value, 15_000_000, '1.5cr should be 1.5 Crores');
assert.equal(parseSalaryInput('2 Crores').value, 20_000_000, '2 Crores should be 2 Crores');

// Thousands / K
assert.equal(parseSalaryInput('50k').value, 50_000, '50k should be 50,000');
assert.equal(parseSalaryInput('50 thousand').value, 50_000, '50 thousand should be 50,000');

// Per Month / Monthly (converted to annual * 12)
assert.equal(parseSalaryInput('50,000 per month').value, 600_000, '50,000/month should be 600,000/yr');
assert.equal(parseSalaryInput('50k/month').value, 600_000, '50k/month should be 600,000/yr');
assert.equal(parseSalaryInput('50k pm').value, 600_000, '50k pm should be 600,000/yr');
assert.equal(parseSalaryInput('50,000 pm').value, 600_000, '50,000 pm should be 600,000/yr');
assert.equal(parseSalaryInput('1 lakh per month').value, 1_200_000, '1 lakh/month should be 1,200,000/yr');

// Plain numbers
assert.equal(parseSalaryInput('77').value, 7_700_000, '77 without unit should be treated as 77 LPA');
assert.equal(parseSalaryInput('12').value, 1_200_000, '12 without unit should be treated as 12 LPA');
assert.equal(parseSalaryInput('6.5').value, 650_000, '6.5 without unit should be treated as 6.5 LPA');
assert.equal(parseSalaryInput('7700000').value, 7_700_000, '7700000 should be raw rupees');
assert.equal(parseSalaryInput('₹7,70,000').value, 770_000, '₹7,70,000 should be formatted rupees');

// Invalid salary
assert.ok(parseSalaryInput('').error, 'empty should error');
assert.ok(parseSalaryInput('abc').error, 'non-number should error');

// Salary display
assert.equal(formatSalaryDisplay(7_700_000), '₹77 LPA');
assert.equal(formatSalaryDisplay(650_000), '₹6.50 LPA');
assert.equal(formatSalaryDisplay(15_000_000), '₹1.50 Cr');
console.log('✓ Salary parsing and formatting tests passed.');

// ─── 2. FUTURE MONTH TESTS ────────────────────────────────────
console.log('2. Testing Future Month Rejection (employment_start & employment_end)...');

const startField = { key: 'employment_start', type: 'month', label: 'Employment start' };
const endField = { key: 'employment_end', type: 'month', label: 'Employment end' };

const now = new Date();
const nextMonthYear = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
const nextMonthNum = now.getMonth() === 11 ? 1 : now.getMonth() + 2;
const futureMonth = `${nextMonthYear}-${String(nextMonthNum).padStart(2, '0')}`;

const pastMonth = '2023-05';

// employment_start in future
const startFutureRes = parseConversationAnswer(startField, futureMonth, true, {});
assert.ok(startFutureRes.error, 'future employment_start must be rejected');
assert.match(startFutureRes.error, /cannot be in the future/i);
assert.match(startFutureRes.error, /till current/i);

// employment_start in past
const startPastRes = parseConversationAnswer(startField, pastMonth, true, {});
assert.equal(startPastRes.value, pastMonth, 'past employment_start must be accepted');

// employment_end in future
const endFutureRes = parseConversationAnswer(endField, futureMonth, true, { employment_start: '2023-01' });
assert.ok(endFutureRes.error, 'future employment_end must be rejected');
assert.match(endFutureRes.error, /cannot be in the future/i);

// employment_end before employment_start
const endBeforeStart = parseConversationAnswer(endField, '2022-01', true, { employment_start: '2023-01' });
assert.ok(endBeforeStart.error, 'end before start must be rejected');

console.log('✓ Future month rejection tests passed.');

// ─── 3. FUTURE YEAR TESTS ─────────────────────────────────────
console.log('3. Testing Future Year Rejection (starting_year & passing_year)...');

const startYearField = { key: 'starting_year', type: 'number', label: 'Starting year' };
const passYearField = { key: 'passing_year', type: 'number', label: 'Passing year' };

// starting_year in future (e.g. 2100 as in user screenshot, or currentYear + 1)
const startYear2100 = parseConversationAnswer(startYearField, '2100', true, {});
assert.ok(startYear2100.error, 'starting_year 2100 must be rejected');
assert.match(startYear2100.error, /cannot be in the future/i);

const startYearFuture = parseConversationAnswer(startYearField, String(now.getFullYear() + 1), true, {});
assert.ok(startYearFuture.error, 'future starting_year must be rejected');

// valid past starting_year
const startYearPast = parseConversationAnswer(startYearField, '2022', true, {});
assert.equal(startYearPast.value, 2022, 'past starting_year must be accepted');

// passing_year 2100
const passYear2100 = parseConversationAnswer(passYearField, '2100', true, { starting_year: 2022 });
assert.ok(passYear2100.error, 'passing_year 2100 must be rejected');

// passing_year within 7 years of starting_year
const passYearValid = parseConversationAnswer(passYearField, '2026', true, { starting_year: 2022 });
assert.equal(passYearValid.value, 2026, 'reasonable passing_year must be accepted');

console.log('✓ Future year rejection tests passed.');

// ─── 4. SALARY CONVERSATION ANSWER TEST ────────────────────────
console.log('4. Testing Salary Conversation Answer integration...');

const salaryField = { key: 'annual_salary', type: 'number', label: 'Annual salary' };
const salaryAns77LPA = parseConversationAnswer(salaryField, '77LPA', true, {});
assert.equal(salaryAns77LPA.value, 7_700_000, 'parseConversationAnswer must parse 77LPA');

const salaryAns50kMo = parseConversationAnswer(salaryField, '50k/month', true, {});
assert.equal(salaryAns50kMo.value, 600_000, 'parseConversationAnswer must parse 50k/month');

console.log('✓ All conversation validation tests passed successfully!');
