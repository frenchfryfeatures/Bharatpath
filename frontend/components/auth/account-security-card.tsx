"use client";

import { useState } from "react";

import { ChangePasswordModal } from "@/components/auth/change-password-modal";
import { MfaSettingsControl } from "@/components/auth/mfa-settings-control";

/** Account security settings shared by the college and admin consoles. */
export function AccountSecurityCard() {
  const [open, setOpen] = useState(false);

  return (
    <section
      className="flex max-w-[640px] flex-col gap-4 rounded-[12px] border border-[#e5e8ee] bg-white p-5"
      style={{ boxShadow: "0 4px 12px rgba(19, 26, 38, 0.024)" }}
    >
      <span className="flex flex-col gap-1">
        <span className="text-[14px] font-semibold leading-[18px] text-[#172033]">
          Account &amp; security
        </span>
        <span className="text-[12px] font-normal leading-[17px] text-[#7b8494]">
          Manage your password and authenticator.
        </span>
      </span>

      <div className="border-t border-[#eef0f3] pt-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="h-9 cursor-pointer rounded-lg border border-[#d6dbe2] bg-white px-3.5 text-xs font-bold text-[#172033] transition hover:bg-[#f9fafb]"
        >
          Change password
        </button>
      </div>

      <MfaSettingsControl />

      <ChangePasswordModal
        open={open}
        onClose={() => setOpen(false)}
        theme="console"
        pool="BUSINESS"
      />
    </section>
  );
}
