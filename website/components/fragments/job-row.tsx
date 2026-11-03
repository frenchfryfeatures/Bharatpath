import { Briefcase, MapPin } from "lucide-react";

import { formatPay, postedLabel, type ExampleJob } from "@/content/jobs";

export function JobRow({ job, compact = false }: { job: ExampleJob; compact?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="truncate text-[15px] font-semibold text-ink">{job.title}</p>
        <p className="mt-0.5 truncate text-[13px] text-muted">
          {job.organisation} · <span className="text-ink">{job.orgSize}</span>
        </p>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
            {job.mode === "Remote" ? "Remote" : `${job.city}${job.mode === "Hybrid" ? " · Hybrid" : ""}`}
          </span>
          <span className="inline-flex items-center gap-1">
            <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
            {job.experience}
          </span>
          {!compact && <span className="tabular">{formatPay(job.payFrom, job.payTo)}</span>}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <span className="inline-block rounded-[4px] bg-surface px-2 py-0.5 text-[13px] text-ink">{job.type}</span>
        {!compact && <p className="mt-2 text-[13px] text-muted">{postedLabel(job.postedDaysAgo)}</p>}
      </div>
    </div>
  );
}
