const assert = require('assert');
const {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
} = require('libphonenumber-js');

console.log('Testing Phone Number Input logic...');

// 1. Country code catalog sanity
const countries = getCountries();
assert(countries.length > 200, 'Country list should have 200+ countries');
assert(getCountryCallingCode('IN') === '91', 'India calling code must be 91');
assert(getCountryCallingCode('US') === '1', 'US calling code must be 1');
assert(getCountryCallingCode('GB') === '44', 'UK calling code must be 44');

// 2. Logic matching PhoneNumberInput
function countryFromValue(value) {
  if (!value || !value.startsWith('+')) return undefined;
  const parsed = parsePhoneNumberFromString(value);
  if (parsed?.country) return parsed.country;
  const digits = value.slice(1).replace(/\D/g, '');
  return countries
    .filter((country) => digits.startsWith(getCountryCallingCode(country)))
    .sort(
      (a, b) =>
        getCountryCallingCode(b).length - getCountryCallingCode(a).length,
    )[0];
}

function nationalFromValue(value, country) {
  const digits = value.replace(/\D/g, '');
  const dialCode = getCountryCallingCode(country);
  return value.trim().startsWith('+') && digits.startsWith(dialCode)
    ? digits.slice(dialCode.length)
    : digits;
}

function formatE164(nationalDigits, country) {
  const parsed = parsePhoneNumberFromString(nationalDigits, country);
  return nationalDigits
    ? parsed?.isPossible()
      ? parsed.number
      : `+${getCountryCallingCode(country)}${nationalDigits}`
    : '';
}

// 3. Test India number parsing & formatting
assert.strictEqual(countryFromValue('+919876543210'), 'IN');
assert.strictEqual(nationalFromValue('+919876543210', 'IN'), '9876543210');
assert.strictEqual(formatE164('9876543210', 'IN'), '+919876543210');

// 4. Test US number parsing & formatting
assert.strictEqual(countryFromValue('+14155552671'), 'US');
assert.strictEqual(nationalFromValue('+14155552671', 'US'), '4155552671');
assert.strictEqual(formatE164('4155552671', 'US'), '+14155552671');

// 5. Test UK number parsing & formatting
const ukCountry = countryFromValue('+442071838750');
assert.strictEqual(getCountryCallingCode(ukCountry), '44');
assert.strictEqual(nationalFromValue('+442071838750', ukCountry), '2071838750');

// 6. Test Backend Regex Compatibility
const BACKEND_PHONE_REGEX = /^\+[1-9]\d{7,14}$/;
assert(BACKEND_PHONE_REGEX.test(formatE164('9876543210', 'IN')), 'Indian phone must pass backend regex');
assert(BACKEND_PHONE_REGEX.test(formatE164('4155552671', 'US')), 'US phone must pass backend regex');
assert(!BACKEND_PHONE_REGEX.test(formatE164('123', 'IN')), 'Short phone number must fail backend regex');

console.log('All Phone Number Input logic tests passed successfully!');
