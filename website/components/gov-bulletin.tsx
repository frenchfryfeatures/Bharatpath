"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, CalendarClock, Landmark, Search, X } from "lucide-react";

import { Chip } from "@/components/ui";
import type { GovBulletinData, GovNotice } from "@/content/gov";

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : null;

const isNew = (iso: string | null) => Boolean(iso && Date.now() - Date.parse(iso) < 3 * 86_400_000);

const selectCls = "h-12 w-full rounded-full border border-line bg-paper px-4 text-[15px] font-semibold text-ink outline-none focus:border-purple";

function NoticeRow({ n }: { n: GovNotice }) {
  const published = fmt(n.publishedAt);
  const last = fmt(n.lastDate);
  return (
    <li>
      <a
        href={n.link}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="group flex flex-col gap-4 rounded-[20px] border border-line bg-paper p-5 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-lilac-line hover:shadow-lift sm:flex-row sm:items-center sm:p-6"
      >
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gold-soft text-gold-ink">
          <Landmark className="h-5 w-5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            {isNew(n.publishedAt) && <Chip tone="green">New</Chip>}
            <Chip tone="lavender">{n.category}</Chip>
            <Chip tone="sand">{n.state}</Chip>
          </span>
          <span className="mt-2 block text-[17px] font-bold leading-snug tracking-[-0.01em] text-ink">{n.title}</span>
          <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[14px] text-muted">
            <span>{n.sourceName}</span>
            {published && <span>Published {published}</span>}
            {last && (
              <span className="inline-flex items-center gap-1 font-semibold text-gold-ink">
                <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Last date {last}
              </span>
            )}
          </span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[15px] font-semibold text-purple">
          Official notice <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" aria-hidden="true" />
          <span className="sr-only">(opens the official website)</span>
        </span>
      </a>
    </li>
  );
}

export function GovBulletin({ data }: { data: GovBulletinData }) {
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [state, setState] = useState("");
  const [source, setSource] = useState("");

  const categories = useMemo(() => Array.from(new Set(data.notices.map((n) => n.category))).sort(), [data]);
  const states = useMemo(() => Array.from(new Set(data.notices.map((n) => n.state))).sort(), [data]);

  const results = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return data.notices.filter(
      (n) =>
        words.every((w) => `${n.title} ${n.sourceName}`.toLowerCase().includes(w)) &&
        (!category || n.category === category) &&
        (!state || n.state === state) &&
        (!source || n.sourceId === source),
    );
  }, [data, q, category, state, source]);

  if (data.notices.length === 0) {
    return (
      <div className="rounded-[28px] border border-line bg-paper p-8 text-center shadow-card sm:p-14">
        <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gold-soft text-gold-ink">
          <Landmark className="h-6 w-6" aria-hidden="true" />
        </span>
        <p className="mt-5 text-[22px] font-bold tracking-[-0.02em]">We are connecting official sources</p>
        <p className="mx-auto mt-2 max-w-[52ch] text-[16px] text-muted">
          The bulletin will list recruitment notices from official government websites as soon as the first sources are switched on. Until then, look for notices on the official websites of the recruiting body.
        </p>
      </div>
    );
  }

  const filtered = Boolean(q || category || state || source);

  return (
    <div>
      <div className="grid gap-2 rounded-[24px] border border-line bg-paper p-2 shadow-card md:grid-cols-[1fr_200px_200px_220px]">
        <label className="flex min-h-[48px] items-center gap-3 rounded-full px-4 focus-within:bg-sand">
          <Search className="h-5 w-5 shrink-0 text-purple" aria-hidden="true" />
          <span className="sr-only">Search notices</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Post, department or board" className="w-full bg-transparent text-[16px] outline-none" />
        </label>
        <label className="sr-only" htmlFor="g-cat">Category</label>
        <select id="g-cat" value={category} onChange={(e) => setCategory(e.target.value)} className={selectCls}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="sr-only" htmlFor="g-state">State</label>
        <select id="g-state" value={state} onChange={(e) => setState(e.target.value)} className={selectCls}>
          <option value="">All of India</option>
          {states.map((c) => <option key={c}>{c}</option>)}
        </select>
        <label className="sr-only" htmlFor="g-src">Source</label>
        <select id="g-src" value={source} onChange={(e) => setSource(e.target.value)} className={selectCls}>
          <option value="">Every source</option>
          {data.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="mt-5 flex items-center justify-between gap-4">
        <p className="text-[15px] text-muted" aria-live="polite">
          <span className="font-semibold text-ink">{results.length}</span> {results.length === 1 ? "notice" : "notices"}
        </p>
        {filtered && (
          <button type="button" onClick={() => { setQ(""); setCategory(""); setState(""); setSource(""); }} className="inline-flex items-center gap-1 text-[14px] font-semibold text-muted hover:text-ink">
            <X className="h-4 w-4" aria-hidden="true" /> Clear
          </button>
        )}
      </div>

      <ul className="mt-4 grid gap-3 2xl:grid-cols-2">
        {results.map((n) => <NoticeRow key={n.id} n={n} />)}
      </ul>
      {results.length === 0 && (
        <p className="rounded-[20px] border border-line bg-paper p-8 text-center text-muted">No notice matches. Try fewer filters.</p>
      )}
    </div>
  );
}
