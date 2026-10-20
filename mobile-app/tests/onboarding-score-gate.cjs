/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Testing Onboarding Score Gate & Unscored User Recovery...');

// 1. Inspect app/index.tsx
const indexSource = fs.readFileSync(path.resolve(__dirname, '../app/index.tsx'), 'utf8');

// Verify that SplashScreen onFinish verifies score completion
assert.match(
  indexSource,
  /const score = await getMyScore\(\);[\s\S]*score\?\.status === 'READY' && score\?\.value != null[\s\S]*router\.replace\('\/home'\);/,
  'SplashScreen must verify that candidate has a READY score before allowing navigation to /home',
);

// Verify that if score is not ready or throws, it resets intake state and routes to step=intake
assert.match(
  indexSource,
  /setStep\('intake'\);/,
  'Unscored users who close the app must be returned to intake to upload resume again',
);

// Verify that restoreOnboarding also checks getMyScore and routes unscored users to intake
assert.match(
  indexSource,
  /const score = await getMyScore\(\)\.catch\(\(\) => null\);[\s\S]*if \(!score \|\| score\.status !== 'READY' \|\| score\.value == null\)[\s\S]*setStep\('intake'\);/,
  'restoreOnboarding must route candidates without a READY score back to intake',
);

// 2. Inspect app/home.tsx
const homeSource = fs.readFileSync(path.resolve(__dirname, '../app/home.tsx'), 'utf8');
assert.match(
  homeSource,
  /getMyScore\(\)[\s\S]*router\.replace\('\/\?step=intake'\)/,
  'HomeRoute must enforce score gate and redirect unscored candidates to /?step=intake',
);

console.log('✓ All onboarding score gate and resume re-upload tests passed successfully!');
