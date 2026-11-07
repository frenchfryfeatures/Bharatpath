"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { JobRow } from "@/components/fragments/job-row";
import { EXAMPLE_JOBS, type ExampleJob } from "@/content/jobs";

const CHIPS: { label: string; test: (j: ExampleJob) => boolean }[] = [
  { label: "All", test: () => true },
  { label: "MSME", test: (j) => j.orgSize === "MSME" },
  { label: "Freshers", test: (j) => j.experience === "Fresher" },
  { label: "Internships", test: (j) => j.type === "Internship" || j.type === "Apprenticeship" },
  { label: "Remote", test: (j) => j.mode === "Remote" },
];

/** The hero's working panel: pick a chip and the list answers. */
export function HeroPreview() {
  const [chip, setChip] = useState(1);
  const results = useMemo(() => EXAMPLE_JOBS.filter((j) => CHIPS[chip].test(j)), [chip]);

  return (
    <div data-ui className="w-full rounded-[24px] border border-line bg-paper p-4 shadow-float sm:p-5">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-[15px] font-bold text-ink">Hiring now</p>
        <span className="text-[13px] text-muted">Example roles</span>
      </div>
      <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto" role="group" aria-label="Quick filters">
        {CHIPS.map((c, i) => (
          <button
            key={c.label}
            type="button"
            aria-pressed={chip === i}
            onClick={() => setChip(i)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
              chip === i ? "bg-purple text-white" : "bg-sand text-body hover:bg-gold-soft"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <ul key={chip} className="swap-in mt-2 divide-y divide-line" aria-live="polite">
        {results.slice(0, 4).map((j) => (
          <li key={j.id} className="px-1 py-3">
            <JobRow job={j} />
          </li>
        ))}
      </ul>
      <Link
        href={`/jobs/?tag=${encodeURIComponent(CHIPS[chip].label === "All" ? "" : CHIPS[chip].label)}`}
        className="mt-3 flex items-center justify-center rounded-full bg-lavender py-3 text-[14px] font-semibold text-purple-deep transition-colors hover:bg-lavender-2"
      >
        {CHIPS[chip].label === "All" ? `See all ${results.length} roles` : `See all ${results.length} roles: ${CHIPS[chip].label}`}
      </Link>
    </div>
  );
}
