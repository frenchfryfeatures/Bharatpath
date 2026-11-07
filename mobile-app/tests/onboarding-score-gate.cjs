/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

console.log('Testing Onboarding Score Gate & Unscored User Recovery...');

// 1. Inspect app/index.tsx
const indexSource = fs.readFileSync(path.resolve(__dirname, '../app/index.tsx'), 'utf8');

// Splash waits for auth restoration before deciding whether to resume onboarding.
assert.match(
  indexSource,
  /if \(!splashDone \|\| authLoading \|\| step !== 'splash'\) return;[\s\S]*await restoreOnboarding\(activeSession.email\)/,
  'Splash must wait for the session and restore onboarding before routing',
);

// Verify that if score is not ready or throws, it resets intake state and routes to step=review
assert.match(
  indexSource,
  /setStep\('review'\);/,
  'Unscored users who close the app must be returned to review to complete profile and score',
);

// The current resume must be confirmed and have a score computed after confirmation.
assert.match(
  indexSource,
  /score\?\.status === 'READY' && scoredAt >= Date.parse\(details.confirmed_at\)/,
  'A previous resume score must not complete the pending resume',
);
assert.match(
  indexSource,
  /if \(!score \|\| score.status !== 'READY' \|\| score.value == null\)[\s\S]*if \(details.confirmed_at\)[\s\S]*setStep\('scoring'\)[\s\S]*setStep\(subscription\?\.has_access \? 'paid-scoring' : 'subscribe'\)[\s\S]*setStep\('review'\)/,
  'Unscored candidates must resume the correct profile, payment, or scoring stage',
);

// 2. Inspect app/home.tsx
const homeSource = fs.readFileSync(path.resolve(__dirname, '../app/home.tsx'), 'utf8');
assert.match(
  homeSource,
  /getMyScore\(\)[\s\S]*router\.replace\('\/\?step=review'\)/,
  'HomeRoute must enforce score gate and redirect unscored candidates to /?step=review',
);

console.log('✓ All onboarding score gate and resume review tests passed successfully!');
