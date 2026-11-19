"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Search } from "lucide-react";

const POPULAR = ["Accounts", "Nurse", "CNC", "Sales", "Teacher", "Data analyst"];

/** The listing-site search: what, where, go. Hands over to /jobs/ with the query in the URL. */
export function SearchBar() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");

  const go = (query: string, place: string) => {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (place.trim()) p.set("where", place.trim());
    router.push(`/jobs/${p.toString() ? `?${p}` : ""}`);
  };

  return (
    <div>
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(q, city);
        }}
        className="flex flex-col gap-2 rounded-[24px] border border-line bg-paper p-2 shadow-float sm:flex-row sm:items-center sm:rounded-full"
      >
        <label className="flex min-h-[52px] flex-1 items-center gap-3 rounded-full px-4 focus-within:bg-sand">
          <Search className="h-5 w-5 shrink-0 text-purple" aria-hidden="true" />
          <span className="sr-only">Job title, skill or industry</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job title or skill" className="w-full bg-transparent text-[16px] text-ink outline-none" />
        </label>
        <span className="mx-1 hidden h-8 w-px bg-line sm:block" aria-hidden="true" />
        <label className="flex min-h-[52px] items-center gap-3 rounded-full px-4 focus-within:bg-sand sm:w-[30%]">
          <MapPin className="h-5 w-5 shrink-0 text-purple" aria-hidden="true" />
          <span className="sr-only">City or state</span>
          <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City or state" className="w-full bg-transparent text-[16px] text-ink outline-none" />
        </label>
        <button type="submit" className="min-h-[52px] rounded-full bg-purple px-7 text-[16px] font-semibold text-white shadow-purple transition-colors hover:bg-purple-deep">
          Search jobs
        </button>
      </form>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="text-[14px] text-muted">Popular:</span>
        {POPULAR.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => go(p, "")}
            className="rounded-full border border-line bg-paper px-3.5 py-1.5 text-[14px] font-medium text-body transition-colors hover:border-lilac-line hover:bg-lavender hover:text-purple-deep"
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
