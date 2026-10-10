"use client";

import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";
import { useScrollLock } from "@/hooks/use-scroll-lock";

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  panelClassName?: string;
  variant?: "default" | "student";
}

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
  closeDisabled = false,
  panelClassName = "",
  variant = "default",
}: Readonly<ModalProps>) {
  const titleId = useId();
  const descriptionId = useId();
  useScrollLock(open);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabled) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDisabled, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <dialog
      data-scroll-lock-root
      open
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) {
          onClose();
        }
      }}
      className="fixed inset-0 z-100 m-0 flex h-screen w-screen max-w-none items-center justify-center bg-[#151b2b]/45 p-4"
    >
      <section
        className={`max-h-[90vh] w-full overflow-y-auto overscroll-contain rounded-[14px] border border-[#e7e9ee] bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.18)] ${variant === "student" ? "font-sans text-[13px] leading-5" : ""} ${panelClassName || "max-w-[560px]"}`}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2
              id={titleId}
              className={`${variant === "student" ? "text-[16px] leading-5" : "text-[16px] leading-5"} font-semibold text-[#151b2b]`}
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className={`mt-1.5 text-[#687182] ${variant === "student" ? "text-[13px] leading-5" : "text-[12px] leading-[17px]"}`}
              >
                {description}
              </p>
            ) : null}
          </div>

          {!closeDisabled ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-[#7b8494] transition-colors hover:bg-[#f5f6f8] hover:text-[#151b2b]"
            >
              <X size={17} strokeWidth={1.8} />
            </button>
          ) : null}
        </header>

        <div className="mt-5">{children}</div>
      </section>
    </dialog>
  );
}
