/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(
  __dirname,
  '../services/profile/structuredResume.ts',
);
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const loaded = new Module(filename, module);
loaded._compile(compiled, filename);
const {
  readyStructuredResume,
  structuredResumeSections,
  structuredResumeCareerDetails,
} = loaded.exports;

const structured = {
  full_name: 'Sameer Gupta',
  headline: 'Mobile developer',
  location: 'Pune',
  contacts: {
    email: 'sameer@example.com',
    phone: '+919876543210',
    github: 'https://github.com/sameer',
  },
  experience: [
    {
      job_title: 'Engineer',
      company: 'Example',
      start_date: '2023-01',
      is_current: true,
      highlights: ['Built the app'],
      skills_used: ['React Native'],
    },
  ],
  education: [
    {
      qualification: 'BTech',
      field_of_study: 'Computer Science',
      institution: 'Example University',
      end_date: '2023',
    },
  ],
  skills: ['TypeScript'],
  projects: [{ name: 'Portfolio', url: 'https://example.com' }],
  certifications: ['AWS Practitioner'],
  languages: ['English'],
  achievements: ['Hackathon winner'],
  interests: ['Open source'],
  other_sections: [{ heading: 'Volunteering', items: ['Mentor'] }],
};

assert.equal(
  readyStructuredResume({
    structured_status: 'READY',
    structured_resume: structured,
    parsed: {},
  }),
  structured,
);
assert.equal(
  readyStructuredResume({
    structured_status: 'FAILED',
    structured_resume: structured,
    parsed: {},
  }),
  null,
);

const sections = structuredResumeSections(structured);
assert.match(sections.find((section) => section.kind === 'header').body, /sameer@example.com/);
assert.match(sections.find((section) => section.kind === 'experience').body, /Built the app/);
assert.match(sections.find((section) => section.kind === 'education').body, /Computer Science/);
assert.deepEqual(
  sections.find((section) => section.kind === 'skills').items,
  [{ text: 'TypeScript', unclear: false }],
);
assert.match(sections.find((section) => section.heading === 'Volunteering').body, /Mentor/);

const career = structuredResumeCareerDetails(structured, {
  phone: '+911111111111',
  course_type: 'FULL_TIME',
});
assert.equal(career.phone, '+919876543210');
assert.equal(career.work_status, 'EXPERIENCED');
assert.equal(career.currently_employed, 'YES');
assert.equal(career.company_name, 'Example');
assert.equal(career.job_title, 'Engineer');
assert.equal(career.current_city, 'Pune');
assert.equal(career.highest_qualification, 'BTech');
assert.equal(career.specialization_name, 'Computer Science');
assert.deepEqual(career.key_skills, ['TypeScript']);
assert.equal(career.course_type, 'FULL_TIME');

// City sanitization regression checks
const { sanitizeCity } = loaded.exports;
assert.equal(sanitizeCity('Kanpur, India'), 'Kanpur');
assert.equal(sanitizeCity('Gurugram, Haryana'), 'Gurugram');
assert.equal(sanitizeCity('Rajpura, Punjab'), 'Rajpura');
assert.equal(sanitizeCity('Bengaluru, Karnataka, India'), 'Bengaluru');
assert.equal(sanitizeCity('Pune 411001'), 'Pune');
assert.equal(sanitizeCity('New Delhi, Delhi'), 'New Delhi');
assert.equal(sanitizeCity('St. Louis, MO'), 'St. Louis');
assert.equal(sanitizeCity("O'Fallon, IL"), "O'Fallon");
assert.equal(sanitizeCity('12345'), '');
assert.equal(sanitizeCity('---'), '');

console.log('Structured resume response mapping and city sanitization checks passed.');
