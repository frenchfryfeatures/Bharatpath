const assert = require('node:assert/strict');

// Verify presentation logic matching web portal format
function formatMinor(minor) {
  const rupees = minor / 100;
  const whole = Math.floor(rupees);
  const paise = Math.round((rupees - whole) * 100);
  const digits = String(whole);
  const head = digits.length > 3 ? digits.slice(0, digits.length - 3) : '';
  const tail = digits.slice(-3);
  const grouped = head ? `${head.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${tail}` : tail;
  return paise > 0 ? `₹${grouped}.${String(paise).padStart(2, '0')}` : `₹${grouped}`;
}

// Check prices from web portal: ₹149, ₹399, ₹699, ₹1,199
assert.equal(formatMinor(14900), '₹149');
assert.equal(formatMinor(39900), '₹399');
assert.equal(formatMinor(69900), '₹699');
assert.equal(formatMinor(119900), '₹1,199');

// Check date formatting
const sampleDate = new Date('2026-11-07T00:00:00Z');
const formatted = sampleDate.toLocaleDateString('en-IN', {
  day: 'numeric',
  month: 'numeric',
  year: 'numeric',
});
assert.match(formatted, /7\/11\/2026|07\/11\/2026/);

console.log('Subscription presentation and money formatting checks passed.');
