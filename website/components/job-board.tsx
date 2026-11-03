"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Info, Search, SlidersHorizontal, X } from "lucide-react";

import { JobRow } from "@/components/fragments/job-row";
import {
  EXAMPLE_JOBS,
  EXPERIENCE_LEVELS,
  JOB_TYPES,
  ORG_SIZES,
  WORK_MODES,
  type ExampleJob,
} from "@/content/jobs";

/**
 * The public board preview. Every filter is one a candidate can use in the
 * app; none of them is age or gender, and none ever will be (invariant 5).
 */

type Filters = {
  q: string;
  city: string;
  modes: string[];
  types: string[];
  experience: string[];
  sizes: string[];
  industry: string;
  minPay: number;
  sort: "newest" | "pay";
};

const EMPTY: Filters = { q: "", city: "", modes: [], types: [], experience: [], sizes: [], industry: "", minPay: 0, sort: "newest" };

const CITIES = Array.from(new Set(EXAMPLE_JOBS.map((j) => j.city))).sort();
const INDUSTRIES = Array.from(new Set(EXAMPLE_JOBS.map((j) => j.industry))).sort();
const PAY_STEPS = [0, 15000, 25000, 40000, 60000];

/** Shortcuts from the home page's chips (`?tag=`). */
const TAGS: Record<string, Partial<Filters>> = {
  MSME: { sizes: ["MSME"] },
  Freshers: { experience: ["Fresher"] },
  Internships: { types: ["Internship", "Apprenticeship"] },
  Remote: { modes: ["Remote"] },
};

function fromUrl(): Filters {
  if (typeof window === "undefined") return EMPTY;
  const p = new URLSearchParams(window.location.search);
  const list = (k: string) => p.get(k)?.split(",").filter(Boolean) ?? [];
  const tag = TAGS[p.get("tag") ?? ""] ?? {};
  return {
    ...EMPTY,
    q: p.get("q") ?? "",
    city: p.get("city") ?? "",
    modes: list("mode"),
    types: list("type"),
    experience: list("exp"),
    sizes: list("size"),
    industry: p.get("industry") ?? "",
    minPay: Number(p.get("pay")) || 0,
    sort: p.get("sort") === "pay" ? "pay" : "newest",
    ...tag,
  };
}

function toUrl(f: Filters) {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.city) p.set("city", f.city);
  if (f.modes.length) p.set("mode", f.modes.join(","));
  if (f.types.length) p.set("type", f.types.join(","));
  if (f.experience.length) p.set("exp", f.experience.join(","));
  if (f.sizes.length) p.set("size", f.sizes.join(","));
  if (f.industry) p.set("industry", f.industry);
  if (f.minPay) p.set("pay", String(f.minPay));
  if (f.sort !== "newest") p.set("sort", f.sort);
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

function apply(jobs: ExampleJob[], f: Filters) {
  const words = f.q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = jobs.filter((j) => {
    const hay = `${j.title} ${j.organisation} ${j.industry} ${j.city} ${j.state} ${j.skills.join(" ")}`.toLowerCase();
    return (
      words.every((w) => hay.includes(w)) &&
      (!f.city || j.city === f.city) &&
      (!f.modes.length || f.modes.includes(j.mode)) &&
      (!f.types.length || f.types.includes(j.type)) &&
      (!f.experience.length || f.experience.includes(j.experience)) &&
      (!f.sizes.length || f.sizes.includes(j.orgSize)) &&
      (!f.industry || j.industry === f.industry) &&
      j.payTo >= f.minPay
    );
  });
  return out.sort((a, b) => (f.sort === "pay" ? b.payTo - a.payTo : a.postedDaysAgo - b.postedDaysAgo));
}

function CheckGroup({ legend, options, value, onChange }: { legend: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[15px] font-semibold">{legend}</legend>
      <div className="space-y-1">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <label key={o} className="flex cursor-pointer items-center gap-2.5 py-1 text-[15px]">
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
                className="h-4 w-4 accent-[#0b2a6b]"
              />
              {o}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

const selectCls = "h-11 w-full rounded-[6px] border border-line bg-paper px-3 text-[15px] outline-none focus:border-navy";

export function JobBoard() {
  const [f, setF] = useState<Filters>(EMPTY);
  const [ready, setReady] = useState(false);
  const [drawer, setDrawer] = useState(false);

  // The page is static HTML, so the query string can only be read after
  // hydration. Reading it once on mount is syncing from an external system.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setF(fromUrl());
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) toUrl(f);
  }, [f, ready]);

  useEffect(() => {
    document.body.style.overflow = drawer ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [drawer]);

  const results = useMemo(() => apply(EXAMPLE_JOBS, f), [f]);
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const activeCount =
    f.modes.length + f.types.length + f.experience.length + f.sizes.length + (f.city ? 1 : 0) + (f.industry ? 1 : 0) + (f.minPay ? 1 : 0);

  const panel = (
    <div className="space-y-7">
      <div>
        <label htmlFor="f-city" className="mb-2 block text-[15px] font-semibold">
          Location
        </label>
        <select id="f-city" value={f.city} onChange={(e) => set("city", e.target.value)} className={selectCls}>
          <option value="">Anywhere in India</option>
          {CITIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <CheckGroup legend="Work mode" options={WORK_MODES} value={f.modes} onChange={(v) => set("modes", v)} />
      <CheckGroup legend="Job type" options={JOB_TYPES} value={f.types} onChange={(v) => set("types", v)} />
      <CheckGroup legend="Experience" options={EXPERIENCE_LEVELS} value={f.experience} onChange={(v) => set("experience", v)} />
      <CheckGroup legend="Employer" options={ORG_SIZES} value={f.sizes} onChange={(v) => set("sizes", v)} />
      <div>
        <label htmlFor="f-industry" className="mb-2 block text-[15px] font-semibold">
          Industry
        </label>
        <select id="f-industry" value={f.industry} onChange={(e) => set("industry", e.target.value)} className={selectCls}>
          <option value="">All industries</option>
          {INDUSTRIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="f-pay" className="mb-2 block text-[15px] font-semibold">
          Monthly pay, at least
        </label>
        <select id="f-pay" value={f.minPay} onChange={(e) => set("minPay", Number(e.target.value))} className={selectCls}>
          {PAY_STEPS.map((p) => (
            <option key={p} value={p}>
              {p === 0 ? "Any pay" : `₹${(p / 1000).toFixed(0)},000`}
            </option>
          ))}
        </select>
      </div>
      {activeCount > 0 && (
        <button type="button" onClick={() => setF({ ...EMPTY, q: f.q, sort: f.sort })} className="text-[15px] font-medium text-navy hover:underline">
          Clear filters
        </button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1240px] px-4 pb-10 sm:px-6 lg:px-10">
      <div className="flex flex-col gap-3 sm:flex-row">
        <label htmlFor="jobs-q" className="sr-only">
          Search by role, skill or company type
        </label>
        <div className="flex flex-1 items-center gap-2 rounded-[6px] border border-line bg-paper px-3 focus-within:border-navy">
          <Search className="h-5 w-5 text-muted" aria-hidden="true" />
          <input
            id="jobs-q"
            value={f.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Role, skill or industry"
            className="h-12 w-full bg-transparent text-[16px] outline-none placeholder:text-muted/80"
          />
          {f.q && (
            <button type="button" aria-label="Clear search" onClick={() => set("q", "")} className="text-muted hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setDrawer(true)}
            className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-[6px] bg-surface px-4 text-[15px] font-medium lg:hidden"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filters{activeCount ? ` (${activeCount})` : ""}
          </button>
          <label htmlFor="jobs-sort" className="sr-only">
            Sort
          </label>
          <select id="jobs-sort" value={f.sort} onChange={(e) => set("sort", e.target.value as Filters["sort"])} className={`${selectCls} h-12 flex-1 sm:w-[180px]`}>
            <option value="newest">Newest first</option>
            <option value="pay">Highest pay</option>
          </select>
        </div>
      </div>

      <p className="mt-4 flex items-start gap-2 rounded-[6px] bg-saffron-soft px-4 py-3 text-[15px]">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          These are example roles that show how the board works. Live vacancies, with employer names and the apply button, are in the app once you sign in.
        </span>
      </p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[260px_1fr]">
        <aside aria-label="Filters" className="hidden lg:block">
          {panel}
        </aside>

        <section aria-label="Results">
          <p className="mb-3 text-[15px] text-muted" aria-live="polite">
            {results.length} example {results.length === 1 ? "role" : "roles"}
          </p>
          <ul className="space-y-2">
            {results.map((j) => (
              <li key={j.id} className="rounded-[6px] bg-paper p-5">
                <JobRow job={j} />
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {j.skills.map((s) => (
                    <span key={s} className="rounded-[4px] bg-surface px-2 py-0.5 text-[13px]">
                      {s}
                    </span>
                  ))}
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
                  <Link href="/signup/student/" className="rounded-[6px] bg-navy px-4 py-2 text-[14px] font-medium text-on-navy transition-colors hover:bg-navy-deep">
                    Create account to apply
                  </Link>
                  <Link href="/login/student/" className="text-[14px] font-medium text-navy hover:underline">
                    Already registered? Sign in
                  </Link>
                </div>
              </li>
            ))}
          </ul>
          {results.length === 0 && (
            <div className="rounded-[6px] bg-surface p-8 text-center">
              <p className="font-medium">No example role matches every filter.</p>
              <button type="button" onClick={() => setF(EMPTY)} className="mt-2 text-[15px] font-medium text-navy hover:underline">
                Start again
              </button>
            </div>
          )}
        </section>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button type="button" aria-label="Close filters" className="absolute inset-0 bg-ink/40" onClick={() => setDrawer(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[86svh] overflow-y-auto rounded-t-[12px] bg-ground p-5 pb-8">
            <div className="mb-5 flex items-center justify-between">
              <p className="text-[18px] font-semibold">Filters</p>
              <button type="button" onClick={() => setDrawer(false)} aria-label="Close filters" className="-mr-2 p-2">
                <X className="h-5 w-5" />
              </button>
            </div>
            {panel}
            <button type="button" onClick={() => setDrawer(false)} className="mt-8 h-12 w-full rounded-[6px] bg-navy text-[15px] font-medium text-on-navy">
              Show {results.length} {results.length === 1 ? "role" : "roles"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
