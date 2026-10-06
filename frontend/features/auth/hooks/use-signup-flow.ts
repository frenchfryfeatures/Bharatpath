"use client";

import { useState } from "react";
import QRCode from "qrcode";

import { ApiError } from "@/lib/api/errors";
import { authService } from "../services/auth.service";
import type { SignupResponse } from "../types";

type Pool = "CANDIDATE" | "BUSINESS";

export type SignupPhase = "DETAILS" | "CONFIRM" | "TOTP_SETUP";

export const MIN_PASSWORD_LENGTH = 12;

export function passwordError(password: string, pool: Pool = "BUSINESS"): string | undefined {
  const minimumLength = MIN_PASSWORD_LENGTH;
  if (password.length < minimumLength) {
    return `Use at least ${minimumLength} characters.`;
  }
  if (
    !/[a-z]/.test(password) ||
    !/[A-Z]/.test(password) ||
    !/\d/.test(password) ||
    (pool === "BUSINESS" && !/[^A-Za-z0-9]/.test(password))
  ) {
    return pool === "CANDIDATE" ? "Include an uppercase letter, a lowercase letter and a number." : "Include an uppercase letter, a lowercase letter, a number and a symbol.";
  }
  return undefined;
}

/**
 * The Cognito sign-up sequence both account steps share: email and password,
 * the emailed confirmation code, and - for the business pool, which requires
 * MFA - the authenticator-app setup. `onSignedUp` fires once a session exists.
 */
export function useSignupFlow(
  pool: Pool,
  onSignedUp: (session: SignupResponse, email: string) => void | Promise<void>,
) {
  const [phase, setPhase] = useState<SignupPhase>("DETAILS");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [existingAccount, setExistingAccount] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setNotice(null);
    setExistingAccount(false);
    setBusy(true);
    try {
      await action();
    } catch (caught) {
      setExistingAccount(caught instanceof ApiError && caught.status === 409);
      setError(
        caught instanceof Error
          ? caught.message
          : "Could not create your account. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const register = (nextEmail: string, nextPassword: string) =>
    run(async () => {
      await authService.signup({ email: nextEmail, password: nextPassword, pool });
      setEmail(nextEmail);
      setPassword(nextPassword);
      setPhase("CONFIRM");
    });

  const confirm = (code: string) =>
    run(async () => {
      const result = await authService.completeSignup({ email, password, code, pool });

      if (result.status === "COMPLETE") {
        await onSignedUp(result.session, email);
        return;
      }

      if (result.status === "TOTP_SETUP_REQUIRED") {
        setTotpSecret(result.sharedSecret);
        setQrCodeDataUrl(
          await QRCode.toDataURL(result.setupUri, { margin: 2, width: 200 }).catch(
            () => null,
          ),
        );
        setPhase("TOTP_SETUP");
        return;
      }

      throw new ApiError(
        "Your email is confirmed. Sign in to continue.",
        400,
        "AUTH_ERROR",
      );
    });

  const finishTotp = (code: string) =>
    run(async () => {
      const session = await authService.completeTotpSetup(code, email);
      await onSignedUp(session, email);
    });

  const resend = () =>
    run(async () => {
      await authService.resendSignupCode(email, pool);
      setNotice("A new code was sent to your email.");
    });

  const back = () => {
    setError(null);
    setNotice(null);
    setPhase("DETAILS");
  };

  return {
    phase,
    email,
    totpSecret,
    qrCodeDataUrl,
    existingAccount,
    error,
    notice,
    busy,
    register,
    confirm,
    finishTotp,
    resend,
    back,
  };
}
