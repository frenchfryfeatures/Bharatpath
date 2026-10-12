const assert = require('assert');

function calculatePreviousValue(saved, value, computedAt) {
  if (saved && saved.value === value && saved.computedAt === computedAt) {
    return saved.previousValue;
  }
  return saved && saved.value !== value ? saved.value : null;
}

function computeDelta(saved, value, computedAt) {
  const prev = calculatePreviousValue(saved, value, computedAt);
  const delta = prev == null ? null : value - prev;
  return delta === 0 ? null : delta;
}

// Case 1: Sameer scenario
// Previous score was 889. New score is 836.
const savedSnapshot = {
  value: 889,
  computedAt: '2026-10-06T05:22:56.318394Z',
  previousValue: null,
};
const deltaSameer = computeDelta(
  savedSnapshot,
  836,
  '2026-10-11T10:36:36.107767Z'
);
assert.strictEqual(deltaSameer, -53, 'Sameer score change must be -53');

// Case 2: Reading the snapshot again after persistence with 836
const updatedSnapshot = {
  value: 836,
  computedAt: '2026-10-11T10:36:36.107767Z',
  previousValue: 889,
};
const reReadDelta = computeDelta(
  updatedSnapshot,
  836,
  '2026-10-11T10:36:36.107767Z'
);
assert.strictEqual(reReadDelta, -53, 'Rereading same score must preserve -53 delta');

// Case 3: Score increased from 800 to 826
const lowerSnapshot = {
  value: 800,
  computedAt: '2026-10-01T00:00:00.000Z',
  previousValue: null,
};
const deltaPositive = computeDelta(
  lowerSnapshot,
  826,
  '2026-10-02T00:00:00.000Z'
);
assert.strictEqual(deltaPositive, 26, 'Positive score change must be +26');

// Case 4: First score with no previous history
assert.strictEqual(
  computeDelta(null, 836, '2026-10-11T10:36:36.107767Z'),
  null,
  'First score must return null'
);

console.log('Score change logic tests passed successfully.');
