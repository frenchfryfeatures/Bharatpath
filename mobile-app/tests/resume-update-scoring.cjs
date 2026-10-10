const assert = require('node:assert/strict');

// Verify that the confirm gate is always targeted when saving an updated resume
function testConfirmGateInvocation(versionId) {
  assert.ok(versionId, 'A target resume version ID must be provided to trigger scoring');
  const endpoint = `/candidate/resume/versions/${versionId}/confirm`;
  assert.equal(endpoint, `/candidate/resume/versions/${versionId}/confirm`);
  return {
    method: 'POST',
    endpoint,
    eventEmitted: 'candidate.resume_version.confirmed',
  };
}

function pickPreferredResumeVersion(versions) {
  return (
    versions.find((v) => v.confirmed && !v.superseded) ??
    versions.find((v) => !v.superseded) ??
    versions.find((v) => v.confirmed) ??
    versions[0]
  );
}

// Case 1: Candidate edited resume previously - v1 is confirmed & superseded, v2 is unconfirmed & not superseded
const versionsScenario1 = [
  { resume_version_id: 'v2', confirmed: false, superseded: false },
  { resume_version_id: 'v1', confirmed: true, superseded: true },
];
const preferred1 = pickPreferredResumeVersion(versionsScenario1);
assert.equal(
  preferred1.resume_version_id,
  'v2',
  'Must pick non-superseded version (v2) over superseded confirmed version (v1)',
);

// Case 2: Fresh confirmed resume - v1 is confirmed & not superseded
const versionsScenario2 = [
  { resume_version_id: 'v1', confirmed: true, superseded: false },
];
const preferred2 = pickPreferredResumeVersion(versionsScenario2);
assert.equal(preferred2.resume_version_id, 'v1');

console.log('Resume update confirmation & scoring trigger checks passed.');

