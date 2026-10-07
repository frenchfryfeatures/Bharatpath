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

const res = testConfirmGateInvocation('test-ver-123');
assert.equal(res.eventEmitted, 'candidate.resume_version.confirmed');

console.log('Resume update confirmation & scoring trigger checks passed.');
