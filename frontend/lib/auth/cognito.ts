import { Amplify } from "aws-amplify";
import {
  confirmSignIn,
  confirmResetPassword,
  confirmSignUp,
  fetchAuthSession,
  resendSignUpCode,
  resetPassword,
  signIn,
  signOut,
  signUp,
  updatePassword,
} from "aws-amplify/auth";

export type CognitoPoolType = "CANDIDATE" | "BUSINESS";

export interface CognitoConfig {
  region: string;
  candidatePoolId: string;
  candidateClientId: string;
  businessPoolId: string;
  businessClientId: string;
}

export const COGNITO_CONFIG: CognitoConfig = {
  region: process.env.NEXT_PUBLIC_COGNITO_REGION ?? "ap-south-1",
  candidatePoolId:
    process.env.NEXT_PUBLIC_COGNITO_CANDIDATE_USER_POOL_ID ??
    "ap-south-1_afBHHXfyH",
  candidateClientId:
    process.env.NEXT_PUBLIC_COGNITO_CANDIDATE_CLIENT_ID ??
    "2bpl99ukq9mjalvku2r9rha80u",
  businessPoolId:
    process.env.NEXT_PUBLIC_COGNITO_BUSINESS_USER_POOL_ID ??
    "ap-south-1_YlPonHUV6",
  businessClientId:
    process.env.NEXT_PUBLIC_COGNITO_BUSINESS_CLIENT_ID ??
    "2prgfuo6fmfr4un46gsonth75b",
};

let activeConfiguredPool: CognitoPoolType | null = null;

export function configureAmplify(pool: CognitoPoolType = "CANDIDATE"): void {
  if (typeof window === "undefined") {
    return;
  }

  const isCandidate = pool === "CANDIDATE";
  const userPoolId = isCandidate
    ? COGNITO_CONFIG.candidatePoolId
    : COGNITO_CONFIG.businessPoolId;
  const userPoolClientId = isCandidate
    ? COGNITO_CONFIG.candidateClientId
    : COGNITO_CONFIG.businessClientId;

  Amplify.configure({
    Auth: {
      Cognito: {
        userPoolId,
        userPoolClientId,
        loginWith: {
          email: true,
        },
      },
    },
  });

  activeConfiguredPool = pool;
}

export interface CognitoSignInParams {
  email: string;
  password: string;
  pool: CognitoPoolType;
}

export type CognitoSignInResult =
  | {
      status: "COMPLETE";
      accessToken: string;
      idToken?: string;
    }
  | {
      status: "NEW_PASSWORD_REQUIRED";
    }
  | {
      status: "TOTP_REQUIRED";
    }
  | {
      status: "TOTP_SETUP_REQUIRED";
      sharedSecret: string;
      setupUri: string;
    }
  | {
      status: "CONFIRM_SIGN_UP_REQUIRED";
    };

export function formatCognitoError(error: unknown): string {
  if (!error || typeof error !== "object") {
    return "Authentication failed. Please check your credentials.";
  }

  const err = error as { name?: string };
  const name = err.name ?? "";

  switch (name) {
    case "UserNotFoundException":
      return "No account was found for this email and account type. Please check your selection or sign up.";
    case "NotAuthorizedException":
      return "Incorrect email or password. Please verify your credentials.";
    case "UsernameExistsException":
      return "An account with this email already exists. Sign in instead.";
    case "InvalidPasswordException":
      return "Password does not meet the requirements.";
    case "UserNotConfirmedException":
      return "Your account email is not yet confirmed. Please verify your code.";
    case "PasswordResetRequiredException":
      return "Your password has expired or must be reset before signing in.";
    case "LimitExceededException":
    case "TooManyRequestsException":
      return "Too many attempts. Please wait a moment and try again.";
    case "InvalidParameterException":
      return "Invalid email or password format.";
    case "CodeMismatchException":
      return "Invalid verification code. Please check and try again.";
    case "ExpiredCodeException":
      return "Verification code has expired. Please request a new code.";
    case "EnableSoftwareTokenMFAException":
      return "Could not enable authenticator app MFA. Please try again.";
    default:
      return "Sign-in failed. Please try again.";
  }
}

export async function fetchCognitoAccessToken(): Promise<string> {
  const session = await fetchAuthSession();
  const token = session.tokens?.accessToken?.toString();
  if (!token) {
    throw new Error("Unable to retrieve access token from Cognito session.");
  }
  return token;
}

export async function signInWithCognito({
  email,
  password,
  pool,
}: CognitoSignInParams): Promise<CognitoSignInResult> {
  configureAmplify(pool);

  // Amplify keeps its tokens in browser storage and refuses `signIn` with
  // "There is already a signed in user" while any are there, even expired
  // ones or another pool's. Our own session is the backend token, so a fresh
  // sign-in always starts clean.
  await signOutCognito();

  const trimmedEmail = email.trim();
  const response = await signIn({
    username: trimmedEmail,
    password,
  });

  const { nextStep } = response;

  if (nextStep.signInStep === "DONE") {
    const accessToken = await fetchCognitoAccessToken();
    const session = await fetchAuthSession();
    return {
      status: "COMPLETE",
      accessToken,
      idToken: session.tokens?.idToken?.toString(),
    };
  }

  if (nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED") {
    return { status: "NEW_PASSWORD_REQUIRED" };
  }

  if (nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_TOTP_CODE") {
    return { status: "TOTP_REQUIRED" };
  }

  if (nextStep.signInStep === "CONTINUE_SIGN_IN_WITH_TOTP_SETUP") {
    // The challenge response already carries the TOTP secret - `setUpTOTP()`
    // would call `fetchAuthSession()` for an access token, and there is no
    // session yet: the user hasn't finished signing in.
    const totpDetails = nextStep.totpSetupDetails;
    const setupUri = totpDetails.getSetupUri("BharatPath", trimmedEmail);
    return {
      status: "TOTP_SETUP_REQUIRED",
      sharedSecret: totpDetails.sharedSecret,
      setupUri: setupUri.toString(),
    };
  }

  if (nextStep.signInStep === "CONFIRM_SIGN_UP") {
    return { status: "CONFIRM_SIGN_UP_REQUIRED" };
  }

  throw new Error(`Unsupported authentication step: ${nextStep.signInStep}`);
}

export async function confirmNewPasswordCognito(
  newPassword: string,
  email?: string,
): Promise<CognitoSignInResult> {
  const response = await confirmSignIn({
    challengeResponse: newPassword,
  });

  const { nextStep } = response;
  if (nextStep.signInStep === "DONE") {
    const accessToken = await fetchCognitoAccessToken();
    return { status: "COMPLETE", accessToken };
  }

  if (nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_TOTP_CODE") {
    return { status: "TOTP_REQUIRED" };
  }

  if (nextStep.signInStep === "CONTINUE_SIGN_IN_WITH_TOTP_SETUP") {
    const totpDetails = nextStep.totpSetupDetails;
    const setupUri = totpDetails.getSetupUri("BharatPath", email ?? "User");
    return {
      status: "TOTP_SETUP_REQUIRED",
      sharedSecret: totpDetails.sharedSecret,
      setupUri: setupUri.toString(),
    };
  }

  throw new Error(`Unsupported step after password reset: ${nextStep.signInStep}`);
}

export async function confirmTotpCodeCognito(
  totpCode: string,
): Promise<CognitoSignInResult> {
  const response = await confirmSignIn({
    challengeResponse: totpCode.trim(),
  });

  if (response.nextStep.signInStep === "DONE") {
    const accessToken = await fetchCognitoAccessToken();
    return { status: "COMPLETE", accessToken };
  }

  throw new Error(`Unsupported step after TOTP code: ${response.nextStep.signInStep}`);
}

export async function verifyTotpSetupCognito(
  code: string,
): Promise<CognitoSignInResult> {
  // `verifyTOTPSetup()` is for an already-signed-in user adding MFA from
  // their account settings - it needs an access token that doesn't exist
  // mid-challenge. Completing *this* step, like the TOTP_REQUIRED step, is
  // just answering the sign-in challenge.
  const response = await confirmSignIn({
    challengeResponse: code.trim(),
  });

  if (response.nextStep.signInStep === "DONE") {
    const accessToken = await fetchCognitoAccessToken();
    return { status: "COMPLETE", accessToken };
  }

  throw new Error(
    `Unsupported step after TOTP setup: ${response.nextStep.signInStep}`,
  );
}

export async function signUpWithCognito({
  email,
  password,
  pool,
}: CognitoSignInParams): Promise<void> {
  configureAmplify(pool);

  const trimmedEmail = email.trim();
  await signUp({
    username: trimmedEmail,
    password,
    options: { userAttributes: { email: trimmedEmail } },
  });
}

export async function confirmSignUpCognito(
  email: string,
  confirmationCode: string,
): Promise<void> {
  await confirmSignUp({
    username: email.trim(),
    confirmationCode: confirmationCode.trim(),
  });
}

export async function resendSignUpCodeCognito(email: string): Promise<void> {
  await resendSignUpCode({
    username: email.trim(),
  });
}

export async function signOutCognito(): Promise<void> {
  try {
    await signOut();
  } catch {
    // Ignore sign-out failures
  }
}

/**
 * Forgot password, step 1: Cognito emails a reset code. Unauthenticated, so it
 * only needs the pool the account lives in.
 */
export async function requestPasswordResetCognito(
  email: string,
  pool: CognitoPoolType,
): Promise<void> {
  configureAmplify(pool);
  await resetPassword({ username: email.trim() });
}

/** Forgot password, step 2: the emailed code plus the new password. */
export async function confirmPasswordResetCognito(
  email: string,
  confirmationCode: string,
  newPassword: string,
  pool: CognitoPoolType,
): Promise<void> {
  configureAmplify(pool);
  await confirmResetPassword({
    username: email.trim(),
    confirmationCode: confirmationCode.trim(),
    newPassword,
  });
}

/**
 * Change password for the signed-in user. The caller names the pool (it is
 * read from the stored access token), because the Amplify session behind it
 * is only found when Amplify is configured for that pool.
 */
export async function changePasswordCognito(
  oldPassword: string,
  newPassword: string,
  pool: CognitoPoolType,
): Promise<void> {
  configureAmplify(pool);
  await updatePassword({ oldPassword, newPassword });
}

/** Messages for the forgot- and change-password flows, which differ from sign-in's. */
export function formatPasswordError(
  error: unknown,
  flow: "change" | "reset" = "change",
): string {
  const name =
    error && typeof error === "object" ? ((error as { name?: string }).name ?? "") : "";

  switch (name) {
    case "NotAuthorizedException":
      return flow === "change"
        ? "Your current password is incorrect."
        : "The password for this account cannot be reset right now. Please contact support.";
    case "UserNotFoundException":
      return "No account was found for this email and account type. Please check your selection.";
    case "InvalidPasswordException":
      return "The new password does not meet the requirements.";
    case "CodeMismatchException":
      return "Invalid verification code. Please check and try again.";
    case "ExpiredCodeException":
      return "Verification code has expired. Please request a new code.";
    case "LimitExceededException":
    case "TooManyRequestsException":
    case "TooManyFailedAttemptsException":
      return "Too many attempts. Please wait a moment and try again.";
    case "InvalidParameterException":
      return "A password reset is not available for this account yet. Please contact support.";
    case "UserNotConfirmedException":
      return "Your account email is not yet confirmed. Please confirm it first.";
    case "NetworkError":
      return "Could not reach the server. Check your connection and try again.";
    default:
      return "Something went wrong. Please try again.";
  }
}
