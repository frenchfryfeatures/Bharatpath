"use client";

import { useEffect, useId, type ReactNode } from "react";
import { X } from "lucide-react";

export interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  closeDisabled?: boolean;
  panelClassName?: string;
}

export function Modal({
  open,
  title,
  description,
  children,
  onClose,
  closeDisabled = false,
  panelClassName = "",
}: Readonly<ModalProps>) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabled) {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeDisabled, onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <dialog
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
        className={`max-h-[90vh] w-full overflow-y-auto rounded-[14px] border border-[#e7e9ee] bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.18)] ${panelClassName || "max-w-[560px]"}`}
      >
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2
              id={titleId}
              className="text-[16px] font-semibold leading-5 text-[#151b2b]"
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-1.5 text-[12px] leading-[17px] text-[#687182]"
              >
                {description}
              </p>
            ) : null}
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close dialog"
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-[#7b8494] transition-colors hover:bg-[#f5f6f8] hover:text-[#151b2b] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X size={17} strokeWidth={1.8} />
          </button>
        </header>

        <div className="mt-5">{children}</div>
      </section>
    </dialog>
  );
}
