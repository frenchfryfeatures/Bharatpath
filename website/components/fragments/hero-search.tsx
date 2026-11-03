"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import { JobRow } from "@/components/fragments/job-row";
import { EXAMPLE_JOBS, type ExampleJob } from "@/content/jobs";

const CHIPS: { label: string; test: (j: ExampleJob) => boolean }[] = [
  { label: "All", test: () => true },
  { label: "MSME", test: (j) => j.orgSize === "MSME" },
  { label: "Freshers", test: (j) => j.experience === "Fresher" },
  { label: "Internships", test: (j) => j.type === "Internship" || j.type === "Apprenticeship" },
  { label: "Remote", test: (j) => j.mode === "Remote" },
];

const matches = (j: ExampleJob, q: string) => {
  if (!q) return true;
  const hay = `${j.title} ${j.organisation} ${j.city} ${j.state} ${j.industry} ${j.skills.join(" ")}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
};

/** The hero's working fragment: type, pick a chip, and the list answers. */
export function HeroSearch() {
  const [q, setQ] = useState("");
  const [chip, setChip] = useState(0);

  const results = useMemo(() => EXAMPLE_JOBS.filter((j) => CHIPS[chip].test(j) && matches(j, q)), [q, chip]);
  const href = `/jobs/?${new URLSearchParams({ ...(q ? { q } : {}), ...(chip ? { tag: CHIPS[chip].label } : {}) }).toString()}`;

  return (
    <div data-ui className="w-full max-w-[460px] rounded-[8px] bg-paper p-4 text-ink shadow-[0_24px_60px_-28px_rgba(4,14,40,0.55)] sm:p-5">
      <label htmlFor="hero-q" className="sr-only">
        Search example roles
      </label>
      <div className="flex items-center gap-2 rounded-[6px] border border-line bg-paper px-3 focus-within:border-navy">
        <Search className="h-4 w-4 text-muted" aria-hidden="true" />
        <input
          id="hero-q"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Try “Pune”, “Tally” or “nurse”"
          className="h-11 w-full bg-transparent text-[15px] outline-none placeholder:text-muted/80"
          autoComplete="off"
        />
      </div>

      <div className="mt-3 flex gap-1.5 overflow-x-auto scrollbar-thin pb-1" role="group" aria-label="Quick filters">
        {CHIPS.map((c, i) => (
          <button
            key={c.label}
            type="button"
            aria-pressed={chip === i}
            onClick={() => setChip(i)}
            className={`shrink-0 rounded-[4px] px-2.5 py-1 text-[13px] transition-colors ${
              chip === i ? "bg-navy text-on-navy" : "bg-surface text-ink hover:bg-line"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <ul className="mt-3 divide-y divide-line" aria-live="polite">
        {results.slice(0, 3).map((j) => (
          <li key={j.id} className="py-3">
            <JobRow job={j} compact />
          </li>
        ))}
        {results.length === 0 && (
          <li className="py-6 text-center text-[14px] text-muted">No example role matches that. Try a city or a skill.</li>
        )}
      </ul>

      <div className="mt-1 flex items-center justify-between border-t border-line pt-3">
        <span className="text-[13px] text-muted">
          {results.length} example {results.length === 1 ? "role" : "roles"}
        </span>
        <Link href={href} className="text-[14px] font-medium text-navy hover:underline">
          See them all
        </Link>
      </div>
    </div>
  );
}
