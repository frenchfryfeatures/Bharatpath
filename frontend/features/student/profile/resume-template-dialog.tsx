"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { FilePenLine, LayoutTemplate, Loader2, X } from "lucide-react";

import { useScrollLock } from "@/hooks/use-scroll-lock";
import { useGetBuilderTemplatesQuery, type BuilderTemplateKey } from "@/store/student";

export function ResumeTemplateDialog({
  open,
  onClose,
  onKeep,
  onTemplateSelected,
}: {
  open: boolean;
  onClose: () => void;
  onKeep: () => void;
  onTemplateSelected: (template: BuilderTemplateKey) => void;
}) {
  const [step, setStep] = useState<"question" | "templates">("question");
  const [selected, setSelected] = useState<BuilderTemplateKey | null>(null);
  const templates = useGetBuilderTemplatesQuery(undefined, { skip: !open || step !== "templates" });
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  useScrollLock(open);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => previous?.focus();
  }, [open]);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open, step]);

  const close = () => {
    setStep("question");
    setSelected(null);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])');
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div data-scroll-lock-root className="fixed inset-0 z-[120] grid place-items-center bg-[#0A1931]/45 px-4 py-5" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="resume-template-dialog-title" onKeyDown={onKeyDown} className="w-full max-w-[650px] max-h-full overflow-y-auto outline-none">
        <section className="relative rounded-[26px] border border-[#E7E0D4] bg-white p-6 shadow-[0_22px_55px_rgba(10,25,49,.16)] sm:p-9">
          <button type="button" onClick={close} aria-label="Close resume template dialog" className="absolute right-5 top-5 grid size-9 place-items-center rounded-full border border-[#E7E0D4] bg-white text-[#3A4761] transition hover:bg-[#F7F4EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]"><X size={18} aria-hidden="true" /></button>
          <span className="grid size-14 place-items-center rounded-2xl bg-[#F1EAF7] text-[#5F4DB2]"><LayoutTemplate size={25} aria-hidden="true" /></span>
          <h2 ref={titleRef} id="resume-template-dialog-title" tabIndex={-1} className="mt-6 text-[25px] font-bold leading-8 text-[#0A1931] outline-none">{step === "question" ? "Change your resume template?" : "Choose a resume template"}</h2>
          <p className="mt-2 text-[14px] leading-6 text-[#52617B]">{step === "question" ? "Keep your current template or choose one before editing your resume. Your choice is saved when the editor opens." : "Select a template, then continue to edit your details and preview."}</p>

          {step === "question" ? (
            <div className="mt-7 grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={onKeep} className="flex min-h-32 flex-col items-start rounded-[18px] border border-[#D9D0F5] bg-[#F8F5FF] p-4 text-left transition hover:border-[#5F4DB2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]"><FilePenLine size={21} className="text-[#5F4DB2]" aria-hidden="true" /><span className="mt-4 text-[14px] font-bold text-[#0A1931]">Keep current template</span><span className="mt-1 text-[12px] leading-5 text-[#52617B]">Continue with your saved template.</span></button>
              <button type="button" onClick={() => setStep("templates")} className="flex min-h-32 flex-col items-start rounded-[18px] border border-[#E7E0D4] bg-white p-4 text-left transition hover:border-[#5F4DB2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]"><LayoutTemplate size={21} className="text-[#5F4DB2]" aria-hidden="true" /><span className="mt-4 text-[14px] font-bold text-[#0A1931]">Change template</span><span className="mt-1 text-[12px] leading-5 text-[#52617B]">See the available styles.</span></button>
            </div>
          ) : (
            <div className="mt-7">
              {templates.isLoading && <p className="mb-3 inline-flex items-center gap-2 text-sm text-[#5F4DB2]"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading templates…</p>}
              {templates.isError && <p role="alert" className="mb-3 text-sm text-red-700">Templates could not be loaded. <button type="button" onClick={() => void templates.refetch()} className="underline">Try again</button></p>}
              <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Resume template">
                {(templates.data?.templates ?? []).map((item) => (
                  <button key={item.key} type="button" role="radio" aria-checked={selected === item.key} onClick={() => setSelected(item.key)} className={`min-h-32 rounded-[18px] border p-4 text-left transition hover:border-[#5F4DB2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2] ${selected === item.key ? "border-[#5F4DB2] bg-[#F1EAF7]" : "border-[#E7E0D4] bg-white"}`}><span className="block text-[14px] font-bold text-[#0A1931]">{item.name}</span><span className="mt-1 block text-[12px] leading-5 text-[#52617B]">{item.description}</span></button>
                ))}
              </div>
              <div className="mt-7 flex flex-wrap justify-end gap-3">
                <button type="button" onClick={() => { if (selected) onTemplateSelected(selected); }} disabled={!selected || templates.isLoading || templates.isError} className="rounded-full bg-[#5F4DB2] px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#4A3E8F] disabled:cursor-not-allowed disabled:opacity-50">Continue to editor</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>,
    document.body,
  );
}
