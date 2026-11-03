"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Info, MapPin, Search, SlidersHorizontal, X } from "lucide-react";

import { JobCard } from "@/components/fragments/job-row";
import { buttonClass } from "@/components/ui";
import { EXAMPLE_JOBS, EXPERIENCE_LEVELS, JOB_TYPES, ORG_SIZES, WORK_MODES, type ExampleJob } from "@/content/jobs";

/**
 * The public board preview. Every filter is one a candidate can use in the
 * app; none of them is age or gender, and none ever will be (invariant 5).
 */

type Filters = {
  q: string;
  where: string;
  modes: string[];
  types: string[];
  experience: string[];
  sizes: string[];
  industry: string;
  minPay: number;
  sort: "newest" | "pay";
};

const EMPTY: Filters = { q: "", where: "", modes: [], types: [], experience: [], sizes: [], industry: "", minPay: 0, sort: "newest" };

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
  const p = new URLSearchParams(window.location.search);
  const list = (k: string) => p.get(k)?.split(",").filter(Boolean) ?? [];
  const tag = TAGS[p.get("tag") ?? ""] ?? {};
  return {
    ...EMPTY,
    q: p.get("q") ?? "",
    where: p.get("where") ?? p.get("city") ?? "",
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
  if (f.where) p.set("where", f.where);
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
  const where = f.where.trim().toLowerCase();
  const out = jobs.filter((j) => {
    const hay = `${j.title} ${j.organisation} ${j.industry} ${j.skills.join(" ")}`.toLowerCase();
    return (
      words.every((w) => hay.includes(w)) &&
      (!where || `${j.city} ${j.state}`.toLowerCase().includes(where) || (where === "remote" && j.mode === "Remote")) &&
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

/** Filter options as toggle pills, the way the student portal's filter drawer draws them. */
function PillGroup({ legend, options, value, onChange }: { legend: string; options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-3 text-[15px] font-bold">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((v) => v !== o) : [...value, o])}
              className={`rounded-xl border px-3.5 py-2 text-[14px] font-semibold transition-colors ${
                on ? "border-lilac-line bg-lavender text-purple-deep" : "border-transparent bg-gold-soft text-body hover:border-[#e0d5b5]"
              }`}
            >
              {o}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

const selectCls = "h-12 w-full rounded-xl border border-line bg-paper px-3.5 text-[15px] text-ink outline-none focus:border-purple";

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
  const activeCount = f.modes.length + f.types.length + f.experience.length + f.sizes.length + (f.industry ? 1 : 0) + (f.minPay ? 1 : 0);
  const clear = () => setF({ ...EMPTY, q: f.q, where: f.where, sort: f.sort });

  const panel = (
    <div className="space-y-7">
      <PillGroup legend="Work mode" options={WORK_MODES} value={f.modes} onChange={(v) => set("modes", v)} />
      <PillGroup legend="Job type" options={JOB_TYPES} value={f.types} onChange={(v) => set("types", v)} />
      <PillGroup legend="Experience" options={EXPERIENCE_LEVELS} value={f.experience} onChange={(v) => set("experience", v)} />
      <PillGroup legend="Employer" options={ORG_SIZES} value={f.sizes} onChange={(v) => set("sizes", v)} />
      <div>
        <label htmlFor="f-industry" className="mb-3 block text-[15px] font-bold">
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
        <label htmlFor="f-pay" className="mb-3 block text-[15px] font-bold">
          Monthly pay, at least
        </label>
        <select id="f-pay" value={f.minPay} onChange={(e) => set("minPay", Number(e.target.value))} className={selectCls}>
          {PAY_STEPS.map((p) => (
            <option key={p} value={p}>
              {p === 0 ? "Any pay" : `₹${p.toLocaleString("en-IN")}`}
            </option>
          ))}
        </select>
      </div>
    </div>
  );

  return (
    <div className="shell pb-10">
      <form
        role="search"
        onSubmit={(e) => e.preventDefault()}
        className="flex flex-col gap-2 rounded-[24px] border border-line bg-paper p-2 shadow-card md:flex-row md:items-center md:rounded-full"
      >
        <label className="flex min-h-[52px] flex-1 items-center gap-3 rounded-full px-4 focus-within:bg-sand">
          <Search className="h-5 w-5 shrink-0 text-purple" aria-hidden="true" />
          <span className="sr-only">Job title, skill or industry</span>
          <input value={f.q} onChange={(e) => set("q", e.target.value)} placeholder="Job title, skill or industry" className="w-full bg-transparent text-[16px] outline-none" />
          {f.q && (
            <button type="button" aria-label="Clear search" onClick={() => set("q", "")} className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-sand hover:text-ink">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        <span className="mx-1 hidden h-8 w-px bg-line md:block" aria-hidden="true" />
        <label className="flex min-h-[52px] items-center gap-3 rounded-full px-4 focus-within:bg-sand md:w-[30%]">
          <MapPin className="h-5 w-5 shrink-0 text-purple" aria-hidden="true" />
          <span className="sr-only">City or state</span>
          <input value={f.where} onChange={(e) => set("where", e.target.value)} placeholder="City, state or “remote”" className="w-full bg-transparent text-[16px] outline-none" />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setDrawer(true)} className={`${buttonClass("secondary")} flex-1 lg:hidden`}>
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filters{activeCount ? ` · ${activeCount}` : ""}
          </button>
          <label htmlFor="jobs-sort" className="sr-only">
            Sort
          </label>
          <select id="jobs-sort" value={f.sort} onChange={(e) => set("sort", e.target.value as Filters["sort"])} className="h-[52px] flex-1 rounded-full border border-line bg-paper px-4 text-[15px] font-semibold text-ink outline-none focus:border-purple md:w-[170px] md:flex-none">
            <option value="newest">Newest first</option>
            <option value="pay">Highest pay</option>
          </select>
        </div>
      </form>

      <p className="mt-4 flex items-start gap-3 rounded-[20px] border border-[#efe0b0] bg-gold-soft px-5 py-4 text-[15px] text-body">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-gold-ink" aria-hidden="true" />
        <span>
          These are example roles that show how the board works. Live vacancies, with employer names and the apply button, are in the app once you sign in.
        </span>
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[300px_1fr] xl:gap-10">
        <aside aria-label="Filters" className="hidden lg:block">
          <div className="sticky top-24 rounded-[24px] border border-line bg-paper p-6 shadow-card">
            <div className="mb-6 flex items-center justify-between">
              <p className="text-[18px] font-bold">Filters</p>
              {activeCount > 0 && (
                <button type="button" onClick={clear} className="text-[14px] font-semibold text-muted hover:text-ink">
                  Reset
                </button>
              )}
            </div>
            {panel}
          </div>
        </aside>

        <section aria-labelledby="results-heading">
          <h2 id="results-heading" className="sr-only">
            Results
          </h2>
          <p className="mb-4 text-[15px] text-muted" aria-live="polite">
            <span className="font-semibold text-ink">{results.length}</span> example {results.length === 1 ? "role" : "roles"}
            {f.where && <> in “{f.where}”</>}
          </p>
          <ul className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3">
            {results.map((j) => (
              <li key={j.id}>
                <JobCard job={j} />
              </li>
            ))}
          </ul>
          {results.length === 0 && (
            <div className="rounded-[24px] border border-line bg-paper p-10 text-center shadow-card">
              <p className="text-[18px] font-bold">No example role matches every filter</p>
              <p className="mt-2 text-muted">Try a nearby city, or fewer filters.</p>
              <button type="button" onClick={() => setF(EMPTY)} className={`${buttonClass("secondary")} mt-5`}>
                Start again
              </button>
            </div>
          )}
          <div className="mt-8 flex flex-col items-start justify-between gap-4 rounded-[24px] bg-lavender p-6 sm:flex-row sm:items-center sm:p-8">
            <p className="max-w-[48ch] text-[16px] text-body">
              <span className="block text-[19px] font-bold text-ink">See every live role near you</span>
              Create a free account to see live vacancies and apply.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href="/signup/student/" className={buttonClass("primary")}>
                Create free account
              </Link>
              <Link href="/login/student/" className={buttonClass("secondary")}>
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </div>

      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Filters">
          <button type="button" aria-label="Close filters" className="absolute inset-0 bg-ink/35" onClick={() => setDrawer(false)} />
          <div className="absolute inset-x-0 bottom-0 flex max-h-[88svh] flex-col rounded-t-[28px] bg-cream sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[440px] sm:rounded-none sm:rounded-l-[28px]">
            <div className="flex items-center justify-between border-b border-line px-5 py-4">
              <p className="text-[18px] font-bold">Filters</p>
              <div className="flex items-center gap-1">
                <button type="button" onClick={clear} className="px-2 py-2 text-[14px] font-semibold text-muted hover:text-ink">
                  Reset
                </button>
                <button type="button" onClick={() => setDrawer(false)} aria-label="Close filters" className="grid h-10 w-10 place-items-center rounded-full border border-line bg-paper">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-6">{panel}</div>
            <div className="border-t border-line bg-paper p-4">
              <button type="button" onClick={() => setDrawer(false)} className={`${buttonClass("primary", "lg")} w-full`}>
                Show {results.length} {results.length === 1 ? "role" : "roles"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
