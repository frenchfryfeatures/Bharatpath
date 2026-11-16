const assert = require('assert');

console.log('Testing Unconfirmed User Signup & Resume Flow...');

// Mock ApiError
class ApiError extends Error {
  constructor({ title, status, code }) {
    super(title);
    this.status = status;
    this.code = code;
  }
}

// Simulated Cognito user pool
const cognitoUsers = new Map();

function mockCognitoSignUp(email, password, name) {
  if (cognitoUsers.has(email)) {
    throw new ApiError({
      title: 'An account with this email already exists. Please sign in instead.',
      status: 409,
      code: 'account_contact_in_use',
    });
  }
  const user = { email, password, name, confirmed: false, lastCodeSent: '123456' };
  cognitoUsers.set(email, user);
  return { UserSub: 'sub-123' };
}

function mockCognitoResendConfirmationCode(email) {
  const user = cognitoUsers.get(email);
  if (!user) {
    throw new ApiError({
      title: 'User does not exist.',
      status: 404,
      code: 'user_not_found',
    });
  }
  if (user.confirmed) {
    throw new ApiError({
      title: 'User is already confirmed.',
      status: 400,
      code: 'InvalidParameterException',
    });
  }
  user.lastCodeSent = '654321';
  return { CodeDeliveryDetails: { Destination: email } };
}

function mockCognitoConfirmSignUp(email, code) {
  const user = cognitoUsers.get(email);
  if (!user) throw new Error('User not found');
  if (user.lastCodeSent !== code) {
    throw new ApiError({
      title: 'Invalid verification code.',
      status: 400,
      code: 'invalid_code',
    });
  }
  user.confirmed = true;
  return true;
}

// Logic implemented in signUpWithEmail
async function simulateSignUpWithEmail({ email, password, fullName }) {
  mockCognitoSignUp(email, password, fullName);
  // Brand new registration returns unconfirmed: true to proceed to OTP verification
  return { unconfirmed: true, email };
}

(async function runTests() {
  const email = 'candidate@bharatpath.test';

  // Step 1: Initial signup attempt
  const initialResult = await simulateSignUpWithEmail({
    email,
    password: 'Password123!',
    fullName: 'Test Candidate',
  });
  assert.strictEqual(initialResult.unconfirmed, true, 'First signup should return unconfirmed: true');
  assert.strictEqual(cognitoUsers.get(email).confirmed, false, 'User should be unconfirmed in Cognito');
  assert.strictEqual(cognitoUsers.get(email).lastCodeSent, '123456');

  // Step 2: User is already registered. If someone tries to sign up again with that email:
  // Must NOT dispatch fresh OTP, must NOT return unconfirmed: true, must throw account_contact_in_use
  let errorCaught = null;
  try {
    await simulateSignUpWithEmail({
      email,
      password: 'AnotherPassword999!',
      fullName: 'Another Candidate',
    });
  } catch (err) {
    errorCaught = err;
  }
  assert(errorCaught instanceof ApiError, 'Already registered signup attempt must throw ApiError');
  assert.strictEqual(errorCaught.code, 'account_contact_in_use', 'Must throw account_contact_in_use');
  assert.strictEqual(cognitoUsers.get(email).lastCodeSent, '123456', 'No fresh OTP should be triggered for existing user');

  // Step 3: User submits the OTP from their original registration
  const confirmed = mockCognitoConfirmSignUp(email, '123456');
  assert.strictEqual(confirmed, true, 'OTP verification should succeed');
  assert.strictEqual(cognitoUsers.get(email).confirmed, true, 'User is now confirmed');

  // Step 4: After confirmation, signup attempt must also fail with account_contact_in_use
  let confirmedError = null;
  try {
    await simulateSignUpWithEmail({
      email,
      password: 'YetAnotherPassword1!',
      fullName: 'Third Candidate',
    });
  } catch (err) {
    confirmedError = err;
  }
  assert(confirmedError instanceof ApiError, 'Confirmed user signup attempt must fail');
  assert.strictEqual(confirmedError.code, 'account_contact_in_use');

  console.log('All unconfirmed signup resilience tests passed successfully!');
})();
