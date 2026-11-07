const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const route = fs.readFileSync(path.resolve(__dirname, '../app/index.tsx'), 'utf8');
const profile = fs.readFileSync(path.resolve(__dirname, '../screens/profile/CareerDetailsScreen.tsx'), 'utf8');

assert.doesNotMatch(route, /setOnboardingSection\(3\)/,
  'Returning from payment must not reopen the final profile section');
assert.match(route, /if \(step === 'subscribe'\)[\s\S]*?onBack=\{\(\) => \{\s*setOnboardingSection\(1\);\s*setStep\('review'\);/,
  'Membership Back must open review at its starting section');
assert.match(profile, /if \(onboarding && step > 0 && onboardingMode === null\)[\s\S]*?onPress=\{\(\) => \{\s*setStep\(0\);/,
  'Back from mode choice must go to basic details without repeating mode choice');
assert.match(route, /setStep\(reviewFromParsing \? 'parsing' : 'signup'\)/,
  'Back from basic details must return to the previous intake path');
console.log('Profile and payment Back navigation checks passed.');
