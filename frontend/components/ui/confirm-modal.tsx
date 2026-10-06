"use client";

import { useEffect, type ReactNode } from "react";
import { LogOut, X } from "lucide-react";

import { Button } from "./button";

interface ConfirmModalProps {
  readonly open: boolean;
  readonly title: string;
  readonly description: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  /** Shows a spinner on the confirm button and blocks the dialog while true. */
  readonly confirmLoading?: boolean;
  /** `danger` styles the confirm button red, for irreversible actions. */
  readonly tone?: "default" | "danger";
  /** Replaces the default icon in the header. */
  readonly icon?: ReactNode;
  readonly children?: ReactNode;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
  readonly variant?: "default" | "student";
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmLoading = false,
  tone = "default",
  icon,
  children,
  onClose,
  onConfirm,
  variant = "default",
}: ConfirmModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !confirmLoading) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirmLoading, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <dialog
      open
      className="fixed inset-0 z-100 m-0 flex h-screen w-screen max-w-none items-center justify-center bg-[#151b2b]/45 px-4"
    >
      <div
        aria-labelledby="confirm-modal-title"
        aria-describedby="confirm-modal-description"
        className={`w-full max-w-105 rounded-[14px] border border-[#e7e9ee] bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.18)] ${variant === "student" ? "font-sans text-[13px] leading-5 lg:text-[14px]" : ""}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className={`grid h-10 w-10 shrink-0 place-items-center rounded-[10px] ${
                tone === "danger"
                  ? "bg-[#fff0f1] text-[#c92f3f]"
                  : "bg-[#edf2fa] text-[#3566b8]"
              }`}
            >
              {icon ?? <LogOut size={18} strokeWidth={1.8} />}
            </span>
            <div>
              <h2
                id="confirm-modal-title"
                className={`${variant === "student" ? "text-[16px] leading-6 lg:text-[18px]" : "text-[16px] leading-5.5"} font-semibold text-[#151b2b]`}
              >
                {title}
              </h2>
              <p
                id="confirm-modal-description"
                className={`mt-1.5 text-[#5d6673] ${variant === "student" ? "text-[13px] leading-5 lg:text-[14px]" : "text-[13px] leading-4.75"}`}
              >
                {description}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close confirmation dialog"
            disabled={confirmLoading}
            className="grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-lg text-[#7b8494] transition-colors hover:bg-[#f5f6f8] hover:text-[#151b2b] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        {children ? <div className="mt-4">{children}</div> : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className={variant === "student" ? "lg:h-9 lg:text-[13px]" : ""}
            onClick={onClose}
            disabled={confirmLoading}
          >
            {cancelLabel}
          </Button>
          {tone === "danger" ? (
            <button
              type="button"
              onClick={onConfirm}
              disabled={confirmLoading}
              className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-lg bg-[#c92f3f] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#a82331] disabled:cursor-not-allowed disabled:opacity-60 ${variant === "student" ? "lg:text-[14px]" : ""}`}
            >
              {confirmLoading ? "Working…" : confirmLabel}
            </button>
          ) : (
            <Button
              type="button"
              variant="dark"
              size="sm"
              className={variant === "student" ? "lg:h-9 lg:text-[13px]" : ""}
              onClick={onConfirm}
              isLoading={confirmLoading}
            >
              {confirmLabel}
            </Button>
          )}
        </div>
      </div>
    </dialog>
  );
}
