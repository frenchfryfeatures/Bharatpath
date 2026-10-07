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
const {
  passwordRequirements,
  onboardingDestination,
  membershipResumeVersion,
  profileResumeVersion,
} = loaded.exports;

const careerFilename = path.resolve(__dirname, '../services/api/career.ts');
const careerSource = fs
  .readFileSync(careerFilename, 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace(/^import type .*;$/gm, '');
const careerCompiled = ts.transpileModule(careerSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const careerLoaded = new Module(careerFilename, module);
careerLoaded._compile(careerCompiled, careerFilename);
const apiClientSource = fs.readFileSync(
  path.resolve(__dirname, '../services/api/client.ts'),
  'utf8',
);
const {
  careerDetailsForSave,
  cleanCareerDetailsForApi,
  fieldRequired,
  fieldVisible,
  mergeResumeDetails,
} = careerLoaded.exports;

assert.equal(passwordRequirements('Ashort1').filter((rule) => rule.met).length, 3);
assert.equal(passwordRequirements('OnlyLettersHere').find((rule) => rule.label === 'A number').met, false);
assert.ok(passwordRequirements('StrongPassword12').every((rule) => rule.met), 'symbols are optional');
assert.ok(passwordRequirements('').every((rule) => !rule.met));
assert.match(
  careerSource,
  /new ExpoFile\(file\.fileUri\)/,
  'native resume uploads must include the selected file bytes',
);
assert.match(
  apiClientSource,
  /Platform\.OS !== 'web'[\s\S]*expoFetch/,
  'native multipart resume uploads must use Expo fetch',
);

const completed = { completed: true, resume_version_id: 'current' };
const latest = { resume_version_id: 'current', confirmed: false };
assert.equal(onboardingDestination(completed, latest), 'subscribe', 'completed profiles resume at membership');
assert.equal(onboardingDestination({ ...completed, completed: false }, latest), 'review');
assert.equal(onboardingDestination(completed, { ...latest, resume_version_id: 'replacement' }), 'review');
assert.equal(onboardingDestination(completed, { ...latest, confirmed: true }), 'home');
assert.equal(onboardingDestination(completed), 'review', 'resume-less accounts begin with Basic details');
assert.equal(membershipResumeVersion(completed), 'current');
assert.equal(
  membershipResumeVersion({ completed: false, resume_version_id: 'current' }),
  undefined,
  'payment is blocked until resume-linked profile review is complete',
);
assert.equal(
  profileResumeVersion(
    { resume_version_id: 'profile-linked' },
    { resume_version_id: 'newer-unlinked' },
  ),
  'profile-linked',
  'profile pages do not silently prefill from an unrelated newer version',
);
assert.equal(
  profileResumeVersion(
    { resume_version_id: null },
    { resume_version_id: 'legacy-resume' },
  ),
  'legacy-resume',
  'legacy profiles can import their existing resume once',
);
assert.deepEqual(
  mergeResumeDetails(
    { phone: '+919876543210', current_city: 'Pune', key_skills: ['React'] },
    { phone: '', current_city: 'Mumbai', key_skills: [], course: 'BTech' },
  ),
  {
    phone: '+919876543210',
    current_city: 'Mumbai',
    key_skills: ['React'],
    course: 'BTech',
  },
  'resume facts replace parsed values without erasing fields the parser missed',
);
const companyField = {
  key: 'company_name',
  required: false,
  section: 'employment',
};
assert.equal(
  fieldRequired(companyField, {
    work_status: 'EXPERIENCED',
    currently_employed: 'NO',
  }),
  false,
);
assert.equal(
  fieldVisible(companyField, {
    work_status: 'EXPERIENCED',
    currently_employed: 'NO',
  }),
  false,
);
assert.deepEqual(
  careerDetailsForSave({
    currently_employed: 'NO',
    company_name: 'Old employer',
    job_title: 'Old title',
    key_skills: ['TypeScript'],
    current_city: 'Pune',
  }),
  { currently_employed: 'NO', current_city: 'Pune' },
  'mobile submits the same applicable career fields as the website',
);
assert.deepEqual(
  cleanCareerDetailsForApi({
    work_status: 'FRESHER',
    experience_years: 5,
    experience_months: 6,
    phone: 'invalid-phone',
    employment_start: '2023-99',
    starting_year: 2020,
    passing_year: 2018,
    extra_forbidden_key: 'malicious or unknown value',
  }),
  {
    phone: '',
    work_status: 'FRESHER',
    currently_employed: 'NO',
    experience_years: 0,
    experience_months: 0,
    employment_start: '',
    employment_end: '',
    company_name: '',
    job_title: '',
    annual_salary: null,
    notice_period: '',
    job_role: '',
    starting_year: 2020,
    passing_year: null,
    preferred_salary: null,
    course_type: '',
    gender: '',
    key_skills: [],
    preferred_locations: [],
    current_city: '',
    industry: '',
    department: '',
    role_category: '',
    highest_qualification: '',
    course: '',
    specialization: '',
    specialization_name: '',
    institution: '',
    headline: '',
  },
  'cleanCareerDetailsForApi sanitizes all fields to prevent 422 validation errors on backend',
);

// Verify cleanCareerDetailsForApi properly strips commas, states, and invalid chars for backend
assert.equal(cleanCareerDetailsForApi({ current_city: 'Kanpur, India' }).current_city, 'Kanpur');
assert.equal(cleanCareerDetailsForApi({ current_city: 'Gurugram, Haryana' }).current_city, 'Gurugram');
assert.equal(cleanCareerDetailsForApi({ current_city: 'Rajpura, Punjab' }).current_city, 'Rajpura');
assert.equal(cleanCareerDetailsForApi({ current_city: 'Bengaluru, Karnataka, India' }).current_city, 'Bengaluru');
assert.equal(cleanCareerDetailsForApi({ current_city: 'Pune 411001' }).current_city, 'Pune');
assert.equal(cleanCareerDetailsForApi({ current_city: '12345' }).current_city, '');

console.log('Mobile onboarding policy and resume routing checks passed.');
