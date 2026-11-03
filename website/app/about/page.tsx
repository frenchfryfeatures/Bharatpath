import type { Metadata } from "next";
import Link from "next/link";

import { CtaOpen } from "@/components/cta-open";

export const metadata: Metadata = {
  title: "About us",
  description: "Why BharatPath exists, who it is for, and the commitments the platform is built on.",
  alternates: { canonical: "/about/" },
};

const BELIEFS = [
  {
    title: "Skills over surnames.",
    body: "What someone can do should matter more than the college on their certificate or the city they grew up in. Search runs on skills, experience and place, never on age or gender, and we will never add a filter for either.",
  },
  {
    title: "Nothing about you without you.",
    body: "You confirm what we read from your CV before it is scored. Colleges see you by name only if you share. You see which employers opened your profile.",
  },
  {
    title: "Small employers are most employers.",
    body: "Most jobs in India are in MSMEs: workshops, shops, clinics, schools. The tools a national chain gets should cost a twelve-person business the same few minutes.",
  },
  {
    title: "Your language, not ours.",
    body: "The app speaks English, Hindi, Bengali, Kannada, Marathi and Punjabi throughout, and Gujarati, Tamil and Telugu for the essentials. More is on the way.",
  },
  {
    title: "Data stays in India.",
    body: "Accounts and CVs are stored on servers in Mumbai. You can download everything we hold about you, or ask us to delete it.",
  },
];

export default function AboutPage() {
  return (
    <>
      <section className="mx-auto max-w-[1240px] px-4 pb-16 pt-14 sm:px-6 lg:px-10 lg:pt-24">
        <h1 className="max-w-[16ch] text-[clamp(40px,6vw,88px)] font-semibold leading-[1] tracking-[-0.045em]">
          <span className="mask-line">
            <span>A fairer path</span>
          </span>
          <span className="mask-line">
            <span>to work.</span>
          </span>
        </h1>
        <div className="fade-up mt-10 grid gap-8 lg:grid-cols-12">
          <p className="text-[20px] leading-relaxed lg:col-span-6">
            BharatPath connects three groups that need each other and rarely meet in one place: people looking for work, the businesses hiring them, and the colleges preparing them.
          </p>
          <div className="space-y-4 text-muted lg:col-span-5 lg:col-start-8">
            <p>
              Hiring in India still runs on referrals, notice boards and CVs sent into silence. Job sites were built for metro professionals and large companies; the electrician apprentice in Coimbatore and the textile exporter in Ludhiana were left to work it out.
            </p>
            <p>
              We built BharatPath for them first. A candidate gets a CV, a clear read of where it stands, and an application that tells them what is happening. An employer of any size gets the same hiring tools. A college gets a way to bring its whole batch along.
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="three-sides" className="px-2 sm:px-3">
        <h2 id="three-sides" className="sr-only">
          Who we serve
        </h2>
        <div className="grid gap-2 lg:grid-cols-3">
          {[
            { t: "Candidates", d: "Freshers, ITI and diploma holders, graduates, career changers.", h: "/students/", bg: "bg-navy text-on-navy" },
            { t: "Employers", d: "MSMEs, startups, retail, healthcare, education and large enterprises.", h: "/employers/", bg: "bg-saffron text-ink" },
            { t: "Colleges", d: "Universities, colleges, polytechnics, ITIs and nursing schools.", h: "/colleges/", bg: "bg-surface text-ink" },
          ].map((s) => (
            <Link key={s.t} href={s.h} data-reveal className={`flex min-h-[260px] flex-col justify-between rounded-[6px] p-6 transition-opacity hover:opacity-95 sm:p-8 ${s.bg}`}>
              <span className="text-[34px] font-semibold tracking-[-0.03em]">{s.t}</span>
              <span className="max-w-[32ch] text-[16px] opacity-90">{s.d}</span>
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="beliefs" className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:px-10 lg:py-32">
        <h2 id="beliefs" className="text-[26px] font-semibold tracking-[-0.02em]">
          What we hold ourselves to
        </h2>
        <dl className="mt-12 grid gap-x-12 gap-y-14 md:grid-cols-2">
          {BELIEFS.map((b) => (
            <div key={b.title} data-reveal>
              <dt className="text-[24px] font-semibold leading-tight tracking-[-0.02em]">{b.title}</dt>
              <dd className="mt-3 max-w-[48ch] text-muted">{b.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <CtaOpen title={["Come build", "it with us."]} />
    </>
  );
}
