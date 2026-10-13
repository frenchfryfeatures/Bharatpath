"use client";

import React, { useState } from "react";
import { Copy, Check, Link2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { showFormError } from "@/lib/feedback/form-error";
import type { ReferralCode } from "@/store/college/referral-codes";

export interface InviteStudentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIssueCode: (args: {
    expiresInDays?: number;
    maxUses?: number | null;
  }) => Promise<ReferralCode>;
  isIssuing?: boolean;
}

/*
 * There is no single "invite by email" endpoint. Students reach a college by
 * entering a referral code (handed out like a password) or by accepting a
 * roster-import invitation. This dialog issues a code to share.
 */
export function InviteStudentModal({
  isOpen,
  onClose,
  onIssueCode,
  isIssuing = false,
}: InviteStudentModalProps) {
  const [expiresInDays, setExpiresInDays] = useState("90");
  const [maxUses, setMaxUses] = useState("");
  const [issuedCode, setIssuedCode] = useState<ReferralCode | null>(null);
  const [copied, setCopied] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ expiresInDays?: string; maxUses?: string }>({});

  if (!isOpen) return null;

  const reset = () => {
    setIssuedCode(null);
    setCopied(false);
    setFieldErrors({});
    setMaxUses("");
    setExpiresInDays("90");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const errors = {
      expiresInDays: !/^\d+$/.test(expiresInDays) || Number(expiresInDays) < 1 || Number(expiresInDays) > 365
        ? "Choose 1 to 365 days." : undefined,
      maxUses: maxUses.trim() && (!/^\d+$/.test(maxUses) || Number(maxUses) < 1 || Number(maxUses) > 10_000)
        ? "Enter a whole number from 1 to 10,000, or leave blank." : undefined,
    };
    setFieldErrors(errors);
    if (errors.expiresInDays || errors.maxUses) {
      showFormError("Check the highlighted referral code settings.", { portal: "college", container: e.currentTarget });
      return;
    }

    try {
      const code = await onIssueCode({
        expiresInDays: Number(expiresInDays),
        maxUses: maxUses.trim() ? Number(maxUses) : null,
      });
      setIssuedCode(code);
    } catch (error) {
      showFormError(getApiErrorMessage(error, "Could not issue a referral code."), { portal: "college" });
    }
  };

  const handleCopy = async () => {
    if (!issuedCode) return;
    await navigator.clipboard.writeText(issuedCode.code);
    setCopied(true);
    showSuccessFeedback("Referral code copied successfully.");
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl border border-[#e7e9ee]"
        style={{ fontFamily: "'General Sans', sans-serif" }}
      >
        {/* MODAL HEADER */}
        <div className="flex items-center justify-between pb-4 border-b border-[#e7e9ee]">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#edf2fa] text-[#5b4fcf]">
              <Link2 size={18} strokeWidth={2.2} />
            </div>
            <div>
              <h3 className="text-[16px] font-bold text-[#151b2b]">
                Invite students
              </h3>
              <p className="text-[12px] text-[#777f90]">
                Issue a referral code to hand out
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close dialog"
            className="grid h-8 w-8 place-items-center rounded-lg text-[#777f90] hover:bg-[#f3f4f7] hover:text-[#151b2b] transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {issuedCode ? (
          <div className="py-8 text-center flex flex-col items-center">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-[#eaf5ef] text-[#23805d] mb-3">
              <Check size={24} strokeWidth={2.5} />
            </div>
            <h4 className="text-[15px] font-bold text-[#151b2b]">
              Code ready to share
            </h4>
            <p className="mt-1 text-[13px] text-[#777f90]">
              Treat it like a password - anyone with it can link to your college.
            </p>

            <div className="mt-5 flex w-full items-center justify-between gap-3 rounded-xl border border-[#dfe2e8] bg-[#f8f9fb] px-4 py-3">
              <span className="font-mono text-[16px] font-bold tracking-wider text-[#151b2b]">
                {issuedCode.code}
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#5b4fcf] hover:underline"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={handleClose}
              className="mt-6"
            >
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[12px] font-semibold text-[#303747] mb-1.5">
                  Expires in (days)
                </label>
                <input
                  id="referral-expiry-days"
                  type="number"
                  min={1}
                  max={365}
                  value={expiresInDays}
                  aria-invalid={Boolean(fieldErrors.expiresInDays)}
                  aria-describedby={fieldErrors.expiresInDays ? "referral-expiry-error" : undefined}
                  onChange={(e) => { setExpiresInDays(e.target.value); setFieldErrors((current) => ({ ...current, expiresInDays: undefined })); }}
                  className={`h-[40px] w-full rounded-xl border px-3.5 text-[13px] text-[#151b2b] outline-none focus:border-[#5b4fcf] focus:ring-1 focus:ring-[#5b4fcf]/20 ${fieldErrors.expiresInDays ? "border-[#c92f3f]" : "border-[#dfe2e8]"}`}
                />
                {fieldErrors.expiresInDays && <p id="referral-expiry-error" className="mt-1 text-xs text-[#c92f3f]">{fieldErrors.expiresInDays}</p>}
              </div>

              <div>
                <label className="block text-[12px] font-semibold text-[#303747] mb-1.5">
                  Max uses (optional)
                </label>
                <input
                  id="referral-max-uses"
                  type="number"
                  min={1}
                  max={10000}
                  value={maxUses}
                  aria-invalid={Boolean(fieldErrors.maxUses)}
                  aria-describedby={fieldErrors.maxUses ? "referral-max-uses-error" : undefined}
                  onChange={(e) => { setMaxUses(e.target.value); setFieldErrors((current) => ({ ...current, maxUses: undefined })); }}
                  placeholder="Unlimited"
                  className={`h-[40px] w-full rounded-xl border px-3.5 text-[13px] text-[#151b2b] placeholder:text-[#8a91a0] outline-none focus:border-[#5b4fcf] focus:ring-1 focus:ring-[#5b4fcf]/20 ${fieldErrors.maxUses ? "border-[#c92f3f]" : "border-[#dfe2e8]"}`}
                />
                {fieldErrors.maxUses && <p id="referral-max-uses-error" className="mt-1 text-xs text-[#c92f3f]">{fieldErrors.maxUses}</p>}
              </div>
            </div>

            <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#e7e9ee]">
              <Button
                type="button"
                variant="secondary"
                size="md"
                onClick={handleClose}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="md"
                icon={<Link2 size={15} />}
                disabled={isIssuing}
              >
                {isIssuing ? "Issuing..." : "Issue code"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
