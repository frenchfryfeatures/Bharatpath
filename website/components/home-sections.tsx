import Link from "next/link";
import {
  ArrowRight,
  BookOpen,
  Building2,
  Calculator,
  Factory,
  GraduationCap,
  HardHat,
  HeartPulse,
  Landmark,
  Laptop,
  Megaphone,
  ShoppingBag,
  Truck,
  UserRound,
  Wheat,
} from "lucide-react";

import { JobCard } from "@/components/fragments/job-row";
import { SectionHeading } from "@/components/ui";
import { EXAMPLE_JOBS } from "@/content/jobs";

/* ---------- Three doors ---------- */

const DOORS = [
  {
    icon: UserRound,
    title: "Looking for work",
    body: "Build or upload a CV, apply in a tap, and see every stage of every application.",
    href: "/students/",
    cta: "For job seekers",
    cls: "bg-purple text-white hover:bg-purple-deep hover:shadow-[0_14px_30px_rgba(95,77,178,0.28)]",
    icls: "bg-white/15 text-white",
    bcls: "text-white/90",
  },
  {
    icon: Building2,
    title: "Hiring for your business",
    body: "Post roles, search by skill and city, and move applicants to hired. MSME to enterprise.",
    href: "/employers/",
    cta: "For employers",
    cls: "border border-lilac-line bg-lilac text-ink hover:bg-[#d4cbee] hover:shadow-[0_10px_24px_rgba(74,62,143,0.14)]",
    icls: "bg-white/70 text-purple-deep",
    bcls: "text-body",
  },
  {
    icon: GraduationCap,
    title: "Placing your students",
    body: "Bring your batch on with one code, cover them with seats and follow every placement.",
    href: "/colleges/",
    cta: "For colleges",
    cls: "border border-[#efe0b0] bg-gold-soft text-ink hover:bg-[#f3e7c4] hover:shadow-[0_10px_24px_rgba(122,92,14,0.12)]",
    icls: "bg-white/70 text-gold-ink",
    bcls: "text-body",
  },
];

export function Doors() {
  return (
    <section aria-label="Who BharatPath is for" className="shell">
      <ul className="grid gap-3 sm:grid-cols-2 md:gap-4 lg:grid-cols-3">
        {DOORS.map(({ icon: Icon, ...d }) => (
          <li key={d.title} className="sm:last:col-span-2 lg:last:col-span-1">
            <Link href={d.href} className={`group flex h-full min-h-[220px] flex-col justify-between gap-6 rounded-[24px] p-6 transition-all duration-150 hover:-translate-y-0.5 sm:p-7 ${d.cls}`}>
              <span className={`grid h-11 w-11 place-items-center rounded-xl ${d.icls}`}>
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span>
                <span className="block text-[22px] font-bold leading-tight tracking-[-0.025em]">{d.title}</span>
                <span className={`mt-2 block text-[15px] ${d.bcls}`}>{d.body}</span>
                <span className="mt-5 inline-flex items-center gap-1.5 text-[15px] font-semibold">
                  {d.cta} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Categories ---------- */

const CATEGORIES = [
  { icon: Factory, label: "Manufacturing", q: "Manufacturing" },
  { icon: HeartPulse, label: "Healthcare", q: "Healthcare" },
  { icon: Laptop, label: "Technology", q: "Technology" },
  { icon: ShoppingBag, label: "Retail & e-commerce", q: "Retail" },
  { icon: BookOpen, label: "Education", q: "Education" },
  { icon: Truck, label: "Logistics", q: "Logistics" },
  { icon: Calculator, label: "Accounts", q: "Tally" },
  { icon: Megaphone, label: "Sales & marketing", q: "sales" },
  { icon: HardHat, label: "Construction", q: "Construction" },
  { icon: Wheat, label: "Food processing", q: "Food" },
];

export function Categories() {
  return (
    <section aria-labelledby="cat-heading" className="shell py-20 sm:py-24">
      <SectionHeading id="cat-heading" title="Explore by industry" lead="Work in every sector that keeps India running, not only the ones with a tech park." action={{ href: "/jobs/", label: "All jobs" }} />
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {CATEGORIES.map(({ icon: Icon, label, q }) => (
          <li key={label}>
            <Link
              href={`/jobs/?q=${encodeURIComponent(q)}`}
              className="group flex h-full items-center gap-3 rounded-[20px] border border-line bg-paper p-4 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:border-lilac-line hover:shadow-lift sm:p-5"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-lavender text-purple transition-colors group-hover:bg-purple group-hover:text-white">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="text-[15px] font-semibold leading-snug text-ink">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Featured listings ---------- */

const FEATURED = ["cnc-operator-pune", "data-analyst-hyderabad", "staff-nurse-nagpur", "accounts-assistant-ludhiana", "frontend-intern-bengaluru", "graphic-designer-jaipur"];

export function FeaturedJobs() {
  const jobs = FEATURED.map((id) => EXAMPLE_JOBS.find((j) => j.id === id)!).filter(Boolean);
  return (
    <section aria-labelledby="featured-heading" className="bg-sand py-20 sm:py-24">
      <div className="shell">
        <SectionHeading id="featured-heading" title="Roles open right now" lead="A look at the kind of roles on the board. Live vacancies are inside the app." action={{ href: "/jobs/", label: "Browse every role" }} />
        <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4 xl:grid-cols-3">
          {jobs.map((j) => (
            <li key={j.id}>
              <JobCard job={j} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- Cities ---------- */

const CITIES = ["Pune", "Bengaluru", "Hyderabad", "Kolkata", "Ahmedabad", "Jaipur", "Lucknow", "Coimbatore", "Indore", "Ludhiana", "Kochi", "Patna", "Nagpur", "Bhubaneswar", "Rajkot", "Mysuru"];

export function Cities() {
  return (
    <section aria-labelledby="city-heading" className="shell py-20 sm:py-24">
      <SectionHeading id="city-heading" title="Jobs near you" lead="Tier-2 and tier-3 cities are where most of India works. They come first here." />
      <ul className="flex flex-wrap gap-2 sm:gap-3">
        {CITIES.map((c) => (
          <li key={c}>
            <Link
              href={`/jobs/?where=${encodeURIComponent(c)}`}
              className="inline-flex min-h-[48px] items-center rounded-full border border-line bg-paper px-5 text-[16px] font-medium text-ink transition-colors hover:border-purple hover:bg-purple hover:text-white"
            >
              Jobs in {c}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Government bulletin teaser ---------- */

export function GovTeaser() {
  return (
    <section aria-labelledby="gov-heading" className="shell">
      <Link
        href="/government-jobs/"
        className="group grid gap-6 rounded-[28px] border border-[#efe0b0] bg-gold-soft p-6 transition-all duration-150 hover:shadow-lift sm:p-10 lg:grid-cols-[auto_1fr_auto] lg:items-center lg:gap-10"
      >
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-gold text-ink">
          <Landmark className="h-6 w-6" aria-hidden="true" />
        </span>
        <span>
          <span id="gov-heading" className="block text-[24px] font-bold tracking-[-0.025em] sm:text-[28px]">
            Government jobs bulletin
          </span>
          <span className="mt-2 block max-w-[62ch] text-[16px] text-body">
            Recruitment notices from official government websites, gathered in one list. Every notice links back to its official source, where you apply.
          </span>
        </span>
        <span className="inline-flex items-center gap-2 text-[16px] font-semibold text-ink">
          Open the bulletin <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" aria-hidden="true" />
        </span>
      </Link>
    </section>
  );
}
