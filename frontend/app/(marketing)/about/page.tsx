import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Check, Database, Eye, Globe, Lock, ShieldCheck, Sparkles } from "lucide-react";

import { CtaOpen } from "@/components/marketing/cta-open";
import { SectionHeading } from "@/components/marketing/ui";

export const metadata: Metadata = {
  title: "About us",
  description:
    "Why BharatPath exists, how our three-sided hiring marketplace works across India, and the architectural commitments the platform is built on.",
  alternates: { canonical: "/about/" },
};

const BROKEN_TRIANGLE = [
  {
    role: "For Candidates",
    problem: "Sending CVs into a black hole",
    detail:
      "Skilled ITI diploma holders, nurses, commerce graduates and operators outside metro tech parks apply to dozens of listings without ever hearing if anyone read their CV — or get judged on college pedigree instead of what they can actually do.",
    solution:
      "BharatPath gives every candidate a clean CV builder, a Confirm Gate before scoring, a standardized Readiness Band, and live stage tracking on every application.",
  },
  {
    role: "For Employers & MSMEs",
    problem: "Sorting through unverified resume piles",
    detail:
      "India's MSMEs create the majority of jobs, yet hiring teams either rely on word-of-mouth referrals or spend days reading hundreds of unverified, keyword-stuffed PDFs on metro job boards.",
    solution:
      "BharatPath lets a 12-person workshop in Rajkot and a 40-store chain filter by confirmed skills, city and Readiness Band, ask screening questions upfront, and move candidates to mutually confirmed hires.",
  },
  {
    role: "For Colleges & Institutes",
    problem: "Placement cells limited to campus visits",
    detail:
      "Most regional engineering, degree, polytechnic, ITI and nursing colleges can only host a handful of visiting employers each year, and track student outcomes manually in spreadsheets.",
    solution:
      "BharatPath connects your entire batch to employers hiring nationwide via sponsored seats, while giving placement officers live, privacy-safe cohort telemetry.",
  },
];

const AI_PRINCIPLES = [
  {
    step: "Principle 1",
    title: "AI reads facts; deterministic code scores",
    body: "Language models are great at reading diverse CVs across nursing, manufacturing, accounting and software — but a language model should never invent a person's score. On BharatPath, AI extracts structured facts after you confirm your CV, and versioned, deterministic rules compute the readiness profile.",
  },
  {
    step: "Principle 2",
    title: "No accent, speed or fluency penalties",
    body: "When candidates practise voice interviews in English, Hindi, Bengali, Kannada, Marathi or Punjabi, our evaluation looks strictly at what was said and how it answered the question — never penalizing regional accents, speaking pace or filler words.",
  },
  {
    step: "Principle 3",
    title: "Human review for integrity signals",
    body: "If a document contains hidden white-on-white keywords or injected instructions, our system flags an integrity signal for a human reviewer rather than silently changing a candidate's score.",
  },
];

const BELIEFS = [
  {
    icon: Sparkles,
    title: "Skills over surnames.",
    body: "What someone can do should matter more than the college on their certificate or the city they grew up in. Search runs on skills, experience, readiness band and place — never on age, gender or candidate photographs.",
    guardrail: "Enforced: Zero age, gender or photo fields on employer search",
  },
  {
    icon: Check,
    title: "Nothing about you without you.",
    body: "You inspect and confirm what we read from your CV before it is ever scored. Colleges see you by name only if you explicitly opt in. And you see every organisation that opened your profile in the last 90 days.",
    guardrail: "Enforced: Candidate Confirm Gate & two-stage college consent",
  },
  {
    icon: Lock,
    title: "No spreadsheets of people.",
    body: "Candidates trust BharatPath because their phone numbers and emails are not sold on or exported in bulk. Employers browse masked cards and open individual profiles within hourly and daily fairness caps.",
    guardrail: "Enforced: Masked search cards, no CSV export & audited opens",
  },
  {
    icon: Eye,
    title: "Small employers are most employers.",
    body: "Most jobs in India are in MSMEs: workshops, shops, clinics, schools and regional branches. The hiring tools a national enterprise uses should take a twelve-person business the same few minutes.",
    guardrail: "Enforced: Period-based access & self-serve job composer",
  },
  {
    icon: Globe,
    title: "Your language, not ours.",
    body: "The platform speaks English, Hindi, Bengali, Kannada, Marathi and Punjabi throughout, plus Gujarati, Tamil and Telugu for core flows — including spoken interview questions.",
    guardrail: "Enforced: 9 Indian locales across mobile and web",
  },
  {
    icon: Database,
    title: "Data stays in India, under your control.",
    body: "Accounts, CVs and voice recordings are hosted in Mumbai (AWS ap-south-1). Every candidate can export a complete archive of their data or request full account erasure with a 24-hour cooling-off window.",
    guardrail: "Enforced: Mumbai data residency & DPDP export/erasure",
  },
];

export default function AboutPage() {
  return (
    <>
      {/* Hero */}
      <section className="shell pb-16 pt-14 lg:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full bg-lavender px-4 py-1.5 text-[14px] font-semibold text-purple-deep">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" /> Made in India, for every corner of Bharat
        </span>
        <h1 className="mt-5 max-w-[16ch] text-[clamp(40px,6vw,88px)] font-bold leading-[1] tracking-[-0.045em]">
          <span className="mask-line">
            <span>A fairer path</span>
          </span>
          <span className="mask-line">
            <span className="text-purple">to work.</span>
          </span>
        </h1>
        <div className="fade-up mt-10 grid gap-8 lg:grid-cols-12">
          <p className="text-[21px] font-medium leading-relaxed tracking-[-0.01em] lg:col-span-6">
            BharatPath connects three groups that need each other and rarely meet in one trusted place: people looking for work, the businesses hiring them, and the colleges preparing them.
          </p>
          <div className="space-y-4 text-[16px] text-body lg:col-span-5 lg:col-start-8">
            <p>
              Hiring across India still runs on fragmented referrals, notice boards and CVs sent into silence. Most job portals were designed around metro tech parks and white-collar corporate roles — leaving the machinist in Coimbatore, the staff nurse in Nagpur and the textile exporter in Ludhiana to figure it out alone.
            </p>
            <p>
              We built BharatPath for them first. A candidate gets a structured CV, a verified readiness band and live visibility into every application. An employer of any size gets fast, merit-first shortlisting. A college gets a year-round placement desk for its entire batch.
            </p>
          </div>
        </div>
      </section>

      {/* Three Sides Cards */}
      <section aria-labelledby="three-sides" className="shell">
        <h2 id="three-sides" className="sr-only">
          Who we serve
        </h2>
        <div className="grid gap-3 md:grid-cols-3 md:gap-4">
          {[
            {
              t: "Candidates",
              d: "Freshers, ITI and diploma holders, graduates, healthcare & retail staff, and career switchers.",
              cta: "Explore candidate tools",
              h: "/students/",
              bg: "bg-purple text-white",
            },
            {
              t: "Employers",
              d: "MSMEs, workshops, startups, retail chains, hospitals, schools and large enterprises.",
              cta: "See how hiring works",
              h: "/employers/",
              bg: "border border-[#efe0b0] bg-gold-soft text-ink",
            },
            {
              t: "Colleges",
              d: "Engineering, arts, commerce & science colleges, polytechnics, ITIs and nursing institutes.",
              cta: "Explore campus partnerships",
              h: "/colleges/",
              bg: "border border-lilac-line bg-lilac text-ink",
            },
          ].map((s) => (
            <Link
              key={s.t}
              href={s.h}
              data-reveal
              className={`group flex min-h-[260px] flex-col justify-between rounded-[24px] p-6 transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lift sm:p-8 ${s.bg}`}
            >
              <div>
                <span className="text-[30px] font-bold tracking-[-0.03em] sm:text-[34px]">{s.t}</span>
                <p className="mt-3 max-w-[34ch] text-[16px] opacity-90">{s.d}</p>
              </div>
              <span className="mt-6 inline-flex items-center gap-1.5 text-[15px] font-semibold">
                {s.cta} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Why We Built BharatPath: Fixing the Three-Sided Disconnect */}
      <section aria-labelledby="why-built" className="shell py-20 sm:py-28">
        <SectionHeading
          id="why-built"
          title="Fixing the three-sided disconnect in Indian hiring"
          lead="When candidates, employers and colleges operate in silos, everyone loses time and trust. BharatPath links all three on a single verifiable spine."
        />
        <div className="grid gap-5 lg:grid-cols-3">
          {BROKEN_TRIANGLE.map((item) => (
            <div key={item.role} data-reveal className="flex flex-col justify-between rounded-[24px] border border-line bg-paper p-6 shadow-card sm:p-8">
              <div>
                <span className="inline-flex rounded-full bg-sand px-3 py-1 text-[13px] font-semibold text-purple">
                  {item.role}
                </span>
                <h3 className="mt-4 text-[22px] font-bold leading-snug tracking-[-0.02em]">{item.problem}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">{item.detail}</p>
              </div>
              <div className="mt-6 rounded-2xl bg-lavender p-4 text-[14px] leading-relaxed text-ink">
                <p className="font-semibold text-purple-deep">How BharatPath solves it</p>
                <p className="mt-1 text-body">{item.solution}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Ethical AI & Reproducible Readiness */}
      <section aria-labelledby="ethical-ai" className="bg-sand py-20 sm:py-28">
        <div className="shell">
          <SectionHeading
            id="ethical-ai"
            title="Responsible AI: the model reads, rules decide"
            lead="We use AI where language understanding helps candidates across diverse trades and languages — and keep it strictly out of places where black-box decisions cause harm."
          />
          <div className="grid gap-5 lg:grid-cols-3">
            {AI_PRINCIPLES.map((p) => (
              <div key={p.title} data-reveal className="rounded-[24px] border border-line bg-paper p-6 shadow-card sm:p-8">
                <p className="text-[13px] font-semibold uppercase tracking-wider text-purple">{p.step}</p>
                <h3 className="mt-3 text-[21px] font-bold leading-snug tracking-[-0.02em]">{p.title}</h3>
                <p className="mt-3 text-[15px] leading-relaxed text-muted">{p.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Commitments Built Into Code */}
      <section aria-labelledby="beliefs" className="shell py-20 sm:py-28">
        <SectionHeading
          id="beliefs"
          title="What we hold ourselves to"
          lead="These are not marketing promises in a footer — they are architectural rules enforced directly by our database and platform code."
        />
        <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {BELIEFS.map(({ icon: Icon, title, body, guardrail }) => (
            <div key={title} data-reveal className="flex flex-col justify-between rounded-[24px] border border-line bg-paper p-6 shadow-card sm:p-7">
              <div>
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-lavender text-purple">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <dt className="mt-4 text-[21px] font-bold leading-tight tracking-[-0.025em]">{title}</dt>
                <dd className="mt-3 text-[15px] leading-relaxed text-muted">{body}</dd>
              </div>
              <p className="mt-6 rounded-xl bg-sand px-3.5 py-2 text-[13px] font-medium text-body">
                {guardrail}
              </p>
            </div>
          ))}
        </dl>
      </section>

      <CtaOpen title="Come build your path with us" />
    </>
  );
}
