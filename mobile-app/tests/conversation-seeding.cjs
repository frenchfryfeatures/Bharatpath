const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

console.log('Testing Conversational Mode Seeding and Question Skipping Logic...');

// 1. Verify ConversationPrompt does not contain the step badge or "step 2 of 4"
const promptPath = path.resolve(__dirname, '../screens/onboarding/ConversationPrompt.tsx');
const promptContent = fs.readFileSync(promptPath, 'utf8');

assert.ok(
  !promptContent.includes('progressBadge'),
  'ConversationPrompt should not render progressBadge inside the container',
);
assert.ok(
  !promptContent.includes('progressRow'),
  'ConversationPrompt should not render progressRow inside the container',
);
console.log('✓ "step 2 of 4" badge successfully removed from inside the BharatPath guide container.');

// 2. Transpile and load conversationValidation & career logic
const valFilename = path.resolve(__dirname, '../screens/onboarding/conversationValidation.ts');
const valSource = fs.readFileSync(valFilename, 'utf8')
  .replace(/^import type .*;$/gm, '')
  .replace(/^import .*;$/gm, '');
const valCompiled = ts.transpileModule(valSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const valModule = new Module(valFilename, module);
valModule._compile(valCompiled, valFilename);
const { parseConversationAnswer, formatSalaryDisplay } = valModule.exports;

const careerFilename = path.resolve(__dirname, '../services/api/career.ts');
const careerSource = fs.readFileSync(careerFilename, 'utf8')
  .replace(/^import .*;$/gm, '')
  .replace(/^import type .*;$/gm, '');
const careerCompiled = ts.transpileModule(careerSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const careerModule = new Module(careerFilename, module);
careerModule._compile(careerCompiled, careerFilename);
const { fieldRequired, fieldVisible, missingRequiredCareerFields } = careerModule.exports;

const otherwiseComplete = {
  phone: '+919793273692', work_status: 'FRESHER',
  highest_qualification: 'Bachelors', course: 'BTech', course_type: 'FULL_TIME',
  institution: 'University', starting_year: 2018, passing_year: 2022,
};
assert.deepEqual(missingRequiredCareerFields(otherwiseComplete), ['current_city']);
assert.deepEqual(missingRequiredCareerFields({ ...otherwiseComplete, current_city: 'Delhi' }), []);

// Mock test fields simulating API schema
const mockFields = [
  // Step 1: Employment
  {
    key: 'work_status',
    section: 'employment',
    type: 'select',
    required: true,
    options: [
      { value: 'EXPERIENCED', label: "I'm experienced" },
      { value: 'FRESHER', label: "I'm a fresher" },
    ],
  },
  {
    key: 'currently_employed',
    section: 'employment',
    type: 'select',
    required: false,
    options: [
      { value: 'YES', label: 'Yes' },
      { value: 'NO', label: 'No' },
    ],
  },
  {
    key: 'experience_years',
    section: 'employment',
    type: 'number',
    required: true,
    options: [],
  },
  {
    key: 'company_name',
    section: 'employment',
    type: 'text',
    required: true,
    options: [],
  },
  {
    key: 'annual_salary',
    section: 'employment',
    type: 'number',
    required: false,
    options: [],
  },
  {
    key: 'industry',
    section: 'employment',
    type: 'text',
    required: false,
    options: [],
  },
  {
    key: 'department',
    section: 'employment',
    type: 'text',
    required: false,
    options: [],
  },
  // Step 2: Education
  {
    key: 'highest_qualification',
    section: 'education',
    type: 'select',
    required: true,
    options: [
      { value: 'BACHELORS', label: "Bachelor's Degree" },
      { value: 'MASTERS', label: "Master's Degree" },
    ],
  },
];

const groups = [
  { key: 'basic', title: 'Basic details' },
  { key: 'employment', title: 'Employment details' },
  { key: 'education', title: 'Education details' },
  { key: 'preferences', title: 'Headline and preferences' },
];

function conversationalFieldVisible(field, details, mode = 'conversation') {
  if (!fieldVisible(field, details)) return false;
  if (mode === 'conversation') {
    return field.section === 'preferences' || fieldRequired(field, details);
  }
  return true;
}

function isFieldUnanswered(field, details, history, mode = 'conversation') {
  if (mode === 'conversation' && field.section !== 'preferences' && !fieldRequired(field, details)) {
    return false;
  }
  const value = details[field.key];
  const skipped = history.some(
    (item) => item.key === field.key && item.answer === 'Skipped for now',
  );
  if (skipped && !fieldRequired(field, details)) return false;
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && !value.length)
  ) {
    return true;
  }
  const answer =
    field.key === 'annual_salary' || field.key === 'preferred_salary'
      ? typeof value === 'number'
        ? formatSalaryDisplay(value)
        : String(value)
      : Array.isArray(value)
        ? value.join(', ')
        : String(value);

  return Boolean(
    parseConversationAnswer(
      field,
      answer,
      fieldRequired(field, details),
      details,
    ).error,
  );
}

// 3. Test: Pre-filled work_status = 'EXPERIENCED' from signup
console.log('Testing: Pre-filled work_status skips question 0 and seeds history...');
const draftExperienced = {
  work_status: 'EXPERIENCED',
  experience_years: undefined,
  company_name: '',
};

assert.equal(
  isFieldUnanswered(mockFields[0], draftExperienced, []),
  false,
  'work_status is already filled, should not be unanswered',
);
assert.equal(
  isFieldUnanswered(mockFields.find((f) => f.key === 'experience_years'), draftExperienced, []),
  true,
  'experience_years is missing, should be unanswered',
);

// 4. Test: Pre-filled resume data skips filled fields and advances directly to Education
console.log('Testing: Extracted resume data advances directly to Education (skipping industry/dept)...');
const draftWithResume = {
  work_status: 'EXPERIENCED',
  currently_employed: 'YES',
  experience_years: 3,
  company_name: 'Tech Corp',
  annual_salary: null,
  industry: '',
  department: '',
  highest_qualification: '',
};

// Verify industry and department are NOT in conversationalFieldVisible
const visibleConvEmployment = mockFields.filter(
  (f) => f.section === 'employment' && conversationalFieldVisible(f, draftWithResume, 'conversation'),
);
assert.ok(
  !visibleConvEmployment.some((f) => f.key === 'industry'),
  'industry must be skipped in conversational mode',
);
assert.ok(
  !visibleConvEmployment.some((f) => f.key === 'department'),
  'department must be skipped in conversational mode',
);
assert.ok(
  !visibleConvEmployment.some((f) => f.key === 'annual_salary'),
  'annual_salary must be skipped in conversational mode for employment',
);

// Verify step 1 (employment) has no unanswered required fields
const firstOpenEmployment = visibleConvEmployment.findIndex((f) =>
  isFieldUnanswered(f, draftWithResume, []),
);
assert.equal(
  firstOpenEmployment,
  -1,
  'All required employment fields are satisfied from resume, step 1 should have firstOpen = -1',
);

// Verify step 2 (education) opens with highest_qualification
const visibleConvEducation = mockFields.filter(
  (f) => f.section === 'education' && conversationalFieldVisible(f, draftWithResume, 'conversation'),
);
const firstOpenEducation = visibleConvEducation.findIndex((f) =>
  isFieldUnanswered(f, draftWithResume, []),
);
assert.equal(
  firstOpenEducation,
  0,
  'Education should open at index 0 (highest_qualification)',
);
assert.equal(
  visibleConvEducation[firstOpenEducation].key,
  'highest_qualification',
  'Conversational mode must ask for Education details directly (highest_qualification)',
);

// 5. Test: Currently employed NO hides industry, department, role_category, company_name in manual mode as well
console.log('Testing: currently_employed NO hides industry and department...');
const draftUnemployed = {
  work_status: 'EXPERIENCED',
  currently_employed: 'NO',
  experience_years: 2,
};
const visibleForUnemployed = mockFields.filter(
  (f) => f.section === 'employment' && fieldVisible(f, draftUnemployed),
);
assert.ok(
  !visibleForUnemployed.some((f) => f.key === 'industry'),
  'industry must NOT be visible when candidate is not currently employed',
);
assert.ok(
  !visibleForUnemployed.some((f) => f.key === 'department'),
  'department must NOT be visible when candidate is not currently employed',
);
assert.ok(
  !visibleForUnemployed.some((f) => f.key === 'company_name'),
  'company_name must NOT be visible when candidate is not currently employed',
);

// 6. Test: Fresher skips employment fields and advances
console.log('Testing: Fresher skips experience questions...');
const draftFresher = {
  work_status: 'FRESHER',
  experience_years: 0,
};
const visibleForFresher = mockFields.filter(
  (f) => f.section === 'employment' && fieldVisible(f, draftFresher),
);
assert.ok(
  !visibleForFresher.some((f) => f.key === 'industry'),
  'industry must NOT be visible for fresher',
);
assert.ok(
  !visibleForFresher.some((f) => f.key === 'department'),
  'department must NOT be visible for fresher',
);
assert.ok(
  visibleForFresher.some((f) => f.key === 'currently_employed'),
  'currently_employed question is always asked',
);

console.log('✓ All Conversational Seeding and Skipping tests passed successfully!');
