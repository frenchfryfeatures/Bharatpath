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
  readonly children?: ReactNode;
  readonly onClose: () => void;
  readonly onConfirm: () => void;
}

export function ConfirmModal({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  confirmLoading = false,
  children,
  onClose,
  onConfirm,
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
        className="w-full max-w-105 rounded-[14px] border border-[#e7e9ee] bg-white p-6 shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-[#edf2fa] text-[#3566b8]">
              <LogOut size={18} strokeWidth={1.8} />
            </span>
            <div>
              <h2
                id="confirm-modal-title"
                className="text-[16px] font-semibold leading-5.5 text-[#151b2b]"
              >
                {title}
              </h2>
              <p
                id="confirm-modal-description"
                className="mt-1.5 text-[13px] leading-4.75 text-[#5d6673]"
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
            onClick={onClose}
            disabled={confirmLoading}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant="dark"
            size="sm"
            onClick={onConfirm}
            isLoading={confirmLoading}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
