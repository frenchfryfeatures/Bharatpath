import { Check } from "lucide-react";

const STAGES = ["Submitted", "Viewed", "Shortlisted", "Interview", "Decision", "Hired"] as const;

/** A candidate's view of one application, moving through the real stage machine. */
export function ApplicationTracker({ reached = 3, title = "CNC machine operator", org = "Precision auto-parts maker · Pune" }: { reached?: number; title?: string; org?: string }) {
  return (
    <div data-ui className="w-full max-w-[440px] rounded-[8px] bg-paper p-5 text-ink">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold">{title}</p>
          <p className="text-[13px] text-muted">{org}</p>
        </div>
        <span className="rounded-[4px] bg-saffron-soft px-2 py-0.5 text-[13px] font-medium text-ink">{STAGES[reached]}</span>
      </div>
      <ol className="mt-5 space-y-0">
        {STAGES.map((s, i) => {
          const done = i < reached;
          const current = i === reached;
          return (
            <li key={s} className="relative flex items-center gap-3 pb-3 last:pb-0">
              {i < STAGES.length - 1 && (
                <span aria-hidden="true" className={`absolute left-[9px] top-5 h-[calc(100%-12px)] w-[2px] ${done ? "bg-navy" : "bg-line"}`} />
              )}
              <span
                aria-hidden="true"
                className={`relative z-10 flex h-5 w-5 items-center justify-center rounded-full ${
                  done ? "bg-navy text-on-navy" : current ? "bg-saffron ring-4 ring-saffron-soft" : "bg-surface"
                }`}
              >
                {done && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <span className={`text-[14px] ${current ? "font-semibold" : done ? "text-ink" : "text-muted"}`}>
                {s}
                {current && <span className="sr-only"> (current stage)</span>}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
