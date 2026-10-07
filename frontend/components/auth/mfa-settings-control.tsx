"use client";

import { useEffect, useState } from "react";
import {
  fetchMFAPreference,
  setUpTOTP,
  updateMFAPreference,
  verifyTOTPSetup,
  type FetchMFAPreferenceOutput,
} from "aws-amplify/auth";
import { ShieldCheck } from "lucide-react";
import QRCode from "qrcode";

import { ConfirmModal } from "@/components/ui/confirm-modal";
import { AppSelect } from "@/components/ui/app-select";
import { configureAmplify } from "@/lib/auth/cognito";
import { useSessionIdentity } from "@/lib/auth/use-session-identity";

type PendingChange = "ON" | "OFF" | null;

function mfaError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Could not update authenticator settings. Please try again.";
}

function needsSetup(error: unknown): boolean {
  const name = error && typeof error === "object" && "name" in error
    ? String(error.name)
    : "";
  return name === "InvalidParameterException" || name === "SoftwareTokenMFANotFoundException";
}

function hasTotpEnabled(preference: FetchMFAPreferenceOutput): boolean {
  return preference.enabled?.includes("TOTP") === true || preference.preferred === "TOTP";
}

export function MfaSettingsControl() {
  const { user } = useSessionIdentity();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingChange>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [secret, setSecret] = useState("");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [setupOpen, setSetupOpen] = useState(false);
  const [setupVerified, setSetupVerified] = useState(false);

  useEffect(() => {
    let active = true;
    configureAmplify("BUSINESS");
    void fetchMFAPreference()
      .then((preference) => {
        if (active) setEnabled(hasTotpEnabled(preference));
      })
      .catch((caught) => {
        if (active) setError(mfaError(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const closeSetup = () => {
    setSetupOpen(false);
    setSecret("");
    setQrCode(null);
    setCode("");
    setSetupVerified(false);
  };

  const confirmChange = async () => {
    if (!pending) return;
    const change = pending;
    setPending(null);
    setBusy(true);
    setError("");
    setNotice("");
    try {
      configureAmplify("BUSINESS");
      if (change === "OFF") {
        await updateMFAPreference({ totp: "DISABLED" });
        const preference = await fetchMFAPreference();
        const stillEnabled = hasTotpEnabled(preference);
        setEnabled(stillEnabled);
        if (stillEnabled) {
          setError("Cognito still has authenticator MFA enabled for this account. It may be required by the user pool.");
          return;
        }
        setNotice("Authenticator MFA is off for this account.");
        return;
      }

      try {
        // Cognito retains a previously verified software token after MFA is
        // disabled. Re-enable it directly when one is already associated.
        await updateMFAPreference({ totp: "PREFERRED" });
        const enabledNow = hasTotpEnabled(await fetchMFAPreference());
        setEnabled(enabledNow);
        if (!enabledNow) throw new Error("Cognito did not enable authenticator MFA. Please try again.");
        setNotice("Authenticator MFA is on.");
        return;
      } catch (caught) {
        if (!needsSetup(caught)) throw caught;
      }

      const details = await setUpTOTP();
      setSecret(details.sharedSecret);
      setQrCode(await QRCode.toDataURL(
        details.getSetupUri("BharatPath", user?.email ?? "User").toString(),
        { margin: 2, width: 200 },
      ).catch(() => null));
      setCode("");
      setSetupVerified(false);
      setSetupOpen(true);
    } catch (caught) {
      setError(mfaError(caught));
    } finally {
      setBusy(false);
    }
  };

  const completeSetup = async () => {
    if (!setupVerified && !/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code from your authenticator app.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      configureAmplify("BUSINESS");
      if (!setupVerified) {
        await verifyTOTPSetup({ code });
        setSetupVerified(true);
      }
      await updateMFAPreference({ totp: "PREFERRED" });
      const enabledNow = hasTotpEnabled(await fetchMFAPreference());
      setEnabled(enabledNow);
      if (!enabledNow) throw new Error("Cognito did not enable authenticator MFA. Please try again.");
      setNotice("Authenticator MFA is on.");
      closeSetup();
    } catch (caught) {
      setError(mfaError(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-t border-[#eef0f3] pt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[13px] font-semibold text-[#172033]">Authenticator MFA</p>
          <p className="mt-1 text-xs leading-5 text-[#7b8494]">
            Add an authenticator code to future sign-ins.
          </p>
        </div>
        <AppSelect
          ariaLabel="Authenticator MFA"
          value={enabled === null ? "UNAVAILABLE" : enabled ? "ON" : "OFF"}
          disabled={enabled === null || busy}
          onChange={(value) => {
            if (value === (enabled ? "ON" : "OFF")) return;
            setError("");
            setNotice("");
            setPending(value as PendingChange);
          }}
          options={[
            ...(enabled === null ? [{ value: "UNAVAILABLE", label: loading ? "Loading…" : "Unavailable" }] : []),
            { value: "OFF", label: "Off" },
            { value: "ON", label: "On" },
          ]}
          menuPlacement="auto"
          menuClassName="!min-w-0"
          portal
          className="w-24"
        />
      </div>
      {enabled === false && (
        <p className="mt-2 text-xs leading-5 text-[#7b8494]">
          Your account preference is off. Your sign-in policy may still require a code.
        </p>
      )}
      {notice && <p role="status" className="mt-3 text-xs text-green-700">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-xs text-red-700">{error}</p>}

      <ConfirmModal
        open={pending !== null}
        title={pending === "ON" ? "Turn on authenticator MFA?" : "Turn off authenticator MFA?"}
        description={pending === "ON"
          ? "If your authenticator is already set up, MFA will turn on now. Otherwise, you will scan a QR code and verify a code first."
          : "Turn off authenticator MFA for this account. Your user pool may still require verification."}
        confirmLabel={pending === "ON" ? "Continue" : "Turn off"}
        icon={<ShieldCheck size={18} />}
        onClose={() => setPending(null)}
        onConfirm={() => void confirmChange()}
      />

      <ConfirmModal
        open={setupOpen}
        title="Set up your authenticator"
        description="Scan the QR code, then enter the 6-digit code shown in your authenticator app. MFA turns on after verification."
        confirmLabel="Verify and turn on"
        confirmLoading={busy}
        icon={<ShieldCheck size={18} />}
        onClose={closeSetup}
        onConfirm={() => void completeSetup()}
      >
        {error && <p role="alert" className="mb-3 text-xs text-red-700">{error}</p>}
        {qrCode && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={qrCode} alt="Authenticator setup QR code" className="mx-auto h-44 w-44" />
        )}
        {secret && (
          <p className="mt-3 break-all text-xs text-[#5d6673]">
            Can’t scan? Enter this key in your app: <strong className="select-all font-mono">{secret}</strong>
          </p>
        )}
        <label htmlFor="mfa-setup-code" className="mt-4 block text-xs font-semibold text-[#172033]">
          Authenticator code
        </label>
        <input
          id="mfa-setup-code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
          className="mt-1 h-10 w-full rounded-lg border border-[#d6dbe2] px-3 text-sm tracking-[0.2em]"
        />
      </ConfirmModal>
    </div>
  );
}
