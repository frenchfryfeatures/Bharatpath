"use client";

import { useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";

import { Modal } from "@/components/ui/modal";
import { minPasswordLength, passwordError } from "@/features/auth/hooks/use-signup-flow";
import { formatPasswordError, type CognitoPoolType } from "@/lib/auth/cognito";
import { changeMyPassword, currentPasswordPool } from "@/lib/auth/password";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";

/** Each portal keeps its own look: the same form, that portal's tokens. */
export type PasswordTheme = "student" | "employer" | "console";

interface ThemeClasses {
  label: string;
  input: string;
  primary: string;
  secondary: string;
  error: string;
  hint: string;
  actions: string;
}

const THEMES: Record<PasswordTheme, ThemeClasses> = {
  student: {
    label: "text-[13px] font-semibold text-[#0A1931]",
    input:
      "w-full rounded-[16px] border-[1.5px] border-[#E7E0D4] bg-white py-3 pl-4 pr-11 text-[15px] font-medium leading-6 text-[#0A1931] outline-none transition placeholder:font-normal placeholder:text-[#9AA1AE] focus:border-[#0A1931]",
    primary:
      "flex min-h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#5F4DB2] px-5 text-[14px] font-semibold text-white transition hover:bg-[#4A3E8F] disabled:cursor-not-allowed disabled:opacity-60",
    secondary:
      "min-h-11 min-w-24 cursor-pointer rounded-full border border-[#E7E0D4] bg-white px-5 text-[14px] font-semibold text-[#3A4761] transition hover:bg-[#F7F4EC] disabled:cursor-not-allowed disabled:opacity-60",
    error:
      "rounded-[16px] border border-[#EBC7BA] bg-[#F8E6E0] px-4 py-3 text-[13px] leading-5 text-[#993A22]",
    hint: "text-[12px] leading-4 text-[#5F6B80]",
    actions: "mt-1 flex gap-3",
  },
  employer: {
    label: "text-[11px] font-semibold leading-[15px] text-[#526074]",
    input:
      "min-h-[43px] w-full rounded-[9px] border border-[#dfe4ea] bg-white py-0 pl-3.5 pr-10 text-[13px] text-[#111827] outline-none transition focus:border-[#526cc8] focus:ring-4 focus:ring-[#526cc8]/10",
    primary:
      "flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#5a4bd1] bg-[#5b4ed0] px-3.5 text-xs font-bold text-white hover:bg-[#4f43bd] disabled:cursor-not-allowed disabled:opacity-60",
    secondary:
      "min-h-9 cursor-pointer rounded-lg border border-[#d6dbe2] bg-white px-3.5 text-xs font-bold text-[#172033] disabled:cursor-not-allowed disabled:opacity-60",
    error: "rounded-lg bg-[#fdf1ef] px-3 py-2 text-xs text-[#c0392b]",
    hint: "text-[11px] leading-4 text-[#718096]",
    actions: "mt-1 flex justify-end gap-2",
  },
  console: {
    label: "text-[12px] font-semibold text-[#303747]",
    input:
      "h-10 w-full rounded-lg border border-[#dfe2e8] bg-white pl-3 pr-10 text-[13px] text-[#17233a] outline-none transition focus:border-[#3566b8] focus:ring-2 focus:ring-[#3566b8]/10",
    primary:
      "flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#17233a] px-4 text-[13px] font-semibold text-white transition hover:bg-[#223453] disabled:cursor-not-allowed disabled:opacity-60",
    secondary:
      "h-9 cursor-pointer rounded-lg border border-[#dfe2e8] bg-white px-4 text-[13px] font-semibold text-[#4b5563] transition hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-60",
    error: "rounded-lg border border-[#f3c9c4] bg-[#fdf1ef] px-3 py-2 text-xs text-[#b42318]",
    hint: "text-[11px] leading-4 text-[#6b7280]",
    actions: "mt-1 flex justify-end gap-2",
  },
};

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  theme,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  theme: ThemeClasses;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={theme.label}>
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={theme.input}
        />
        <button
          type="button"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
          onClick={() => setVisible((shown) => !shown)}
          className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-[#9aa2b1] hover:text-[#4b5563]"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

export function ChangePasswordModal({
  open,
  onClose,
  theme: themeName,
  pool,
}: Readonly<{
  open: boolean;
  onClose: () => void;
  theme: PasswordTheme;
  /** The portal's own pool; the stored token's pool wins when it names one. */
  pool: CognitoPoolType;
}>) {
  const theme = THEMES[themeName];
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError("");
  };

  const close = () => {
    if (busy) return;
    reset();
    onClose();
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");

    if (!current) {
      setError("Enter your current password.");
      return;
    }
    const invalid = passwordError(next, currentPasswordPool(pool));
    if (invalid) {
      setError(invalid);
      return;
    }
    if (next === current) {
      setError("Choose a new password that is different from your current one.");
      return;
    }
    if (next !== confirm) {
      setError("The new passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      await changeMyPassword(current, next, pool);
      showSuccessFeedback("Password changed.");
      setBusy(false);
      reset();
      onClose();
    } catch (failure) {
      setError(formatPasswordError(failure));
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      closeDisabled={busy}
      title="Change password"
      description="Enter your current password, then choose a new one."
      variant={themeName === "student" ? "student" : "default"}
      panelClassName="max-w-[440px]"
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4" noValidate>
        {error ? (
          <p role="alert" className={theme.error}>
            {error}
          </p>
        ) : null}

        <PasswordField id="current-password" label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" theme={theme} autoFocus />
        <PasswordField id="new-password" label="New password" value={next} onChange={setNext} autoComplete="new-password" theme={theme} />
        <PasswordField id="confirm-new-password" label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" theme={theme} />
        <p className={theme.hint}>
          At least {minPasswordLength(currentPasswordPool(pool))} characters, with an uppercase letter, a lowercase letter, a number
          {currentPasswordPool(pool) === "BUSINESS" ? " and a symbol." : "."}
        </p>

        <div className={theme.actions}>
          <button type="button" onClick={close} disabled={busy} className={theme.secondary}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={theme.primary}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {busy ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
