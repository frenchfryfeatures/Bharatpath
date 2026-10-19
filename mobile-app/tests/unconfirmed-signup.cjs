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
  let isUnconfirmed = false;
  try {
    mockCognitoSignUp(email, password, fullName);
    // In Cognito, if email verification is enabled, signing in right after signup throws user_not_confirmed
    isUnconfirmed = true;
  } catch (signUpErr) {
    if (
      signUpErr instanceof ApiError &&
      (signUpErr.code === 'account_contact_in_use' ||
        signUpErr.code === 'UsernameExistsException')
    ) {
      try {
        mockCognitoResendConfirmationCode(email);
        isUnconfirmed = true;
      } catch (resendErr) {
        throw signUpErr;
      }
    } else {
      throw signUpErr;
    }
  }

  if (isUnconfirmed) {
    return { unconfirmed: true, email };
  }
  return { session: { email } };
}

(async function runTests() {
  const email = 'candidate@bharatpath.test';

  // Step 1: Initial signup attempt with resume
  const initialResult = await simulateSignUpWithEmail({
    email,
    password: 'Password123!',
    fullName: 'Test Candidate',
  });
  assert.strictEqual(initialResult.unconfirmed, true, 'First signup should return unconfirmed: true');
  assert.strictEqual(cognitoUsers.get(email).confirmed, false, 'User should be unconfirmed in Cognito');
  assert.strictEqual(cognitoUsers.get(email).lastCodeSent, '123456');

  // Step 2: User DOES NOT submit OTP, but comes back and repeats registration with resume
  // Previously: this failed with "account_contact_in_use" (UsernameExistsException)
  // With fix: detects unconfirmed user, dispatches fresh OTP, and allows resuming flow!
  const repeatResult = await simulateSignUpWithEmail({
    email,
    password: 'Password123!',
    fullName: 'Test Candidate',
  });
  assert.strictEqual(repeatResult.unconfirmed, true, 'Repeat signup for unconfirmed user should return unconfirmed: true');
  assert.strictEqual(cognitoUsers.get(email).lastCodeSent, '654321', 'Fresh OTP code should have been dispatched');

  // Step 3: User submits the fresh OTP
  const confirmed = mockCognitoConfirmSignUp(email, '654321');
  assert.strictEqual(confirmed, true, 'OTP verification should succeed');
  assert.strictEqual(cognitoUsers.get(email).confirmed, true, 'User is now confirmed');

  // Step 4: Now that the user IS confirmed, if someone tries to sign up again with that email:
  // It should throw account_contact_in_use
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
  assert(errorCaught instanceof ApiError, 'Confirmed user signup attempt must fail');
  assert.strictEqual(errorCaught.code, 'account_contact_in_use');

  console.log('All unconfirmed signup resilience tests passed successfully!');
})();
