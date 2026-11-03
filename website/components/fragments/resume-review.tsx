import { Check, FileText, Pencil } from "lucide-react";

/** The confirm gate as a candidate meets it: what we read, before anything is scored. */
export function ResumeUpload() {
  return (
    <div data-ui className="w-full max-w-[440px] rounded-[8px] bg-paper p-5 text-ink">
      <p className="text-[15px] font-semibold">Add your resume</p>
      <p className="text-[13px] text-muted">PDF or Word, up to 10 pages. Or build one with our templates.</p>
      <div className="mt-4 flex items-center gap-3 rounded-[6px] bg-surface p-3">
        <FileText className="h-8 w-8 shrink-0 text-navy" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-medium">Ravi_Kumar_CV.pdf</p>
          <p className="text-[13px] text-muted">2 pages · reading it now</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper" aria-hidden="true">
            <div className="h-1.5 w-2/3 rounded-full bg-navy" />
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5" aria-hidden="true">
        {["Classic", "Modern", "Compact", "Two-column"].map((t, i) => (
          <span key={t} className={`rounded-[4px] px-1 py-2 text-center text-[13px] ${i === 1 ? "bg-navy text-on-navy" : "bg-surface"}`}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

export function ResumeReview() {
  const rows = [
    { k: "Experience", v: "Machine operator, auto-components unit, Chakan · 2 yrs 4 mos" },
    { k: "Education", v: "ITI, Machinist · Government ITI Aundh" },
    { k: "Skills", v: "CNC turning, Fanuc controls, Vernier, Micrometer" },
    { k: "Languages", v: "Marathi, Hindi, English" },
  ];
  return (
    <div data-ui className="w-full max-w-[440px] rounded-[8px] bg-paper p-5 text-ink">
      <p className="text-[15px] font-semibold">Is this what your CV says?</p>
      <p className="text-[13px] text-muted">Fix anything we misread. Nothing is scored until you confirm.</p>
      <dl className="mt-4 divide-y divide-line">
        {rows.map((r, i) => (
          <div key={r.k} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <dt className="text-[13px] text-muted">{r.k}</dt>
              <dd className={`text-[14px] ${i === 2 ? "rounded-[4px] bg-saffron-soft px-1 -mx-1" : ""}`}>{r.v}</dd>
            </div>
            <Pencil className="mt-1 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" />
          </div>
        ))}
      </dl>
      <span className="mt-3 flex items-center justify-center gap-2 rounded-[6px] bg-navy py-2.5 text-[14px] font-medium text-on-navy">
        <Check className="h-4 w-4" aria-hidden="true" /> Looks right, confirm
      </span>
    </div>
  );
}
