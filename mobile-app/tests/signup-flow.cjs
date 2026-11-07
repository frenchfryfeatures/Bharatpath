const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mobile = path.resolve(__dirname, '..');
const route = fs.readFileSync(path.join(mobile, 'app/index.tsx'), 'utf8');
const parsing = fs.readFileSync(path.join(mobile, 'screens/onboarding/ParsingScreen.tsx'), 'utf8');
const resumeDetails = fs.readFileSync(path.join(mobile, 'app/resume-details.tsx'), 'utf8');

assert.equal(fs.existsSync(path.join(mobile, 'app/resume-builder.tsx')), false);
assert.doesNotMatch(route, /<ResumeBuilderScreen|<ResumeDecisionScreen|setStep\('resume-builder'\)|setStep\('resume-decision'\)/);
assert.doesNotMatch(resumeDetails, /Build with Resume Builder/);
assert.match(route, /if \(step === 'resume-required'\)[\s\S]*?<ResumeUploadRequiredScreen/);
assert.match(route, /if \(parsingOrigin === 'resume-required'\)[\s\S]*?saveCareerProfile\([\s\S]*?verId, true,[\s\S]*?continueAfterProfile\(saved\)/);
assert.match(parsing, /await onReviewFound\(versionId, versionDetails\)/,
  'Failed finalization must stay on parsing and offer a retry');
console.log('Signup upload and builder removal checks passed.');
