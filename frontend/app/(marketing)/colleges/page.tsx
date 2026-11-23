import type { Metadata } from "next";
import { Award, BookOpen, Cpu, GraduationCap, HeartPulse, Wrench } from "lucide-react";

import { CtaOpen } from "@/components/marketing/cta-open";
import { FaqList } from "@/components/marketing/faq-list";
import { ApplicationTracker } from "@/components/marketing/fragments/application-tracker";
import { CohortPanel } from "@/components/marketing/fragments/cohort-panel";
import {
  ConsentFragment,
  ReferralFragment,
  StudentSeatDetailFragment,
} from "@/components/marketing/fragments/misc";
import { PageHero } from "@/components/marketing/page-hero";
import { SplitRow, SplitRows } from "@/components/marketing/split-rows";
import { SectionHeading } from "@/components/marketing/ui";
import { COLLEGE_FAQ } from "@/content/faq";

export const metadata: Metadata = {
  title: "For colleges and institutions",
  description:
    "Bring your students onto BharatPath with a referral code or roster, give them full platform access through your seats, and follow placement outcomes across your cohort.",
  alternates: { canonical: "/colleges/" },
};

const INSTITUTIONS = [
  {
    icon: Cpu,
    title: "Engineering & technical colleges",
    body: "Connect B.Tech, M.Tech and BCA batches to software, core manufacturing, quality and operations roles beyond traditional campus drives.",
  },
  {
    icon: BookOpen,
    title: "Arts, commerce & science colleges",
    body: "Give B.Com, BBA, BA and B.Sc graduates a structured CV, readiness band and direct reach into accounting, finance, retail and business roles.",
  },
  {
    icon: Wrench,
    title: "Polytechnics & ITIs",
    body: "Help machinists, electricians, fitters and diploma holders showcase hands-on trade skills to industrial units and MSMEs across India.",
  },
  {
    icon: HeartPulse,
    title: "Nursing & paramedical institutes",
    body: "Place nursing, pharmacy and lab technology graduates with multi-speciality hospitals, clinics and diagnostic networks.",
  },
  {
    icon: GraduationCap,
    title: "Management & professional schools",
    body: "Track MBA and PGDM placement funnels from first application to mutually confirmed offer with review-ready cohort telemetry.",
  },
];

const SEAT_BENEFITS = [
  {
    title: "Zero subscription cost for the student",
    body: "A linked student assigned to one of your active college seats gets full candidate platform access without paying for an individual subscription.",
  },
  {
    title: "Standardized, clean batch CVs",
    body: "Every student builds or uploads a CV and reviews extracted skills and education through our Confirm Gate — eliminating messy formatting before employers look.",
  },
  {
    title: "Verified readiness profile & band",
    body: "Students receive their three-digit readiness profile and employer-facing band (Entry, Developing, Solid, Strong) so employers can shortlist by capability.",
  },
  {
    title: "Direct access to pan-India employers",
    body: "Your batch is no longer limited to the handful of companies that visit campus in person. Students apply to verified MSMEs and enterprises nationwide.",
  },
];

export default function CollegesPage() {
  return (
    <>
      <PageHero
        lines={["A placement desk", "that never closes."]}
        lead="Engineering, arts, commerce, polytechnic, ITI or nursing: give every student a place to build their CV, prove their readiness and find work — while your placement cell tracks the entire batch through the season."
        primary={{ href: "/signup/college/", label: "Register your college" }}
        secondary={{ href: "/login?as=college", label: "College sign in" }}
        fragment={<CohortPanel />}
        stage="gold"
      />

      {/* Institution Types We Serve */}
      <section aria-labelledby="campus-types" className="shell pt-12 sm:pt-20">
        <SectionHeading
          id="campus-types"
          title="Built for every campus across Bharat"
          lead="Campus placements should not belong only to metro universities. BharatPath equips every placement cell with the same modern tools."
        />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {INSTITUTIONS.map(({ icon: Icon, title, body }, i) => (
            <li
              key={title}
              data-reveal
              className={`flex flex-col justify-between rounded-[24px] p-6 sm:last:col-span-2 lg:last:col-span-1 ${
                i === 0 ? "bg-purple text-white" : "border border-line bg-paper shadow-card"
              }`}
            >
              <div>
                <span
                  className={`grid h-10 w-10 place-items-center rounded-xl ${
                    i === 0 ? "bg-white/15 text-white" : "bg-gold-soft text-gold-ink"
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-4 text-[18px] font-semibold leading-snug tracking-[-0.02em]">{title}</h3>
                <p className={`mt-2 text-[14px] leading-relaxed ${i === 0 ? "text-white/85" : "text-muted"}`}>{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* What a Sponsored Seat Unlocks */}
      <section aria-labelledby="seat-value" className="shell py-16 sm:py-24">
        <div className="rounded-[28px] border border-[#efe0b0] bg-gold-soft p-6 sm:p-10 lg:p-14">
          <div className="max-w-[680px]">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-paper px-3.5 py-1 text-[13px] font-semibold text-gold-ink">
              <Award className="h-4 w-4" aria-hidden="true" /> College Seat Model
            </span>
            <h2 id="seat-value" className="mt-4 text-[28px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[38px]">
              What one college seat unlocks for your student
            </h2>
            <p className="mt-3 text-[16px] text-body sm:text-[17px]">
              Instead of unpredictable tiers, your institution holds a fixed seat allowance for the period. Every seated student gets immediate access to the full candidate job-search experience.
            </p>
          </div>
          <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SEAT_BENEFITS.map((b) => (
              <div key={b.title} className="rounded-[20px] bg-paper p-5 shadow-card">
                <dt className="text-[17px] font-bold leading-snug tracking-[-0.015em] text-ink">{b.title}</dt>
                <dd className="mt-2.5 text-[14px] leading-relaxed text-muted">{b.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Capabilities SplitRows — zero duplicate fragments */}
      <SplitRows
        id="college-how"
        eyebrow="Campus Placement Workflow"
        heading="How placement teams run on BharatPath"
        lead="Simple student onboarding, automatic seat assignment and live placement telemetry — all in one placement desk."
      >
        <SplitRow
          step="01"
          eyebrow="Batch Onboarding"
          title="Bring your whole batch on with one code or roster."
          body="Share your college referral code in class or on the notice board, or upload a student roster CSV to send email invitations. Students link from their own accounts in seconds."
          points={[
            "Shareable campus referral codes with live usage counters",
            "CSV roster upload with pre-commit email reachability check",
            "Students link directly from mobile or web",
            "Revoke or rotate referral codes anytime",
          ]}
          fragment={<ReferralFragment />}
          stage="lavender"
        />
        <SplitRow
          step="02"
          eyebrow="Sponsored Seat Access"
          title="Your seats cover their candidate subscription."
          body="As soon as a student links with your code or accepts your invitation, an available college seat covers them automatically — unlocking CV confirmation, readiness scoring and job applications."
          points={[
            "Automatic seat assignment upon student link",
            "Students pay nothing for core platform access",
            "Seats return to your pool if a student unlinks",
            "Live seat counter across your entire batch",
          ]}
          fragment={<ApplicationTracker reached={2} title="Accounts assistant" org="Textile exporter · Ludhiana" />}
          stage="purple"
          flip
        />
        <SplitRow
          step="03"
          eyebrow="Two-Stage DPDP Consent"
          title="Students stay in control of what they share."
          body="Every linked student is counted in your anonymised batch analytics automatically. When a student turns on individual sharing, your placement cell can also view their name, CV, readiness band and active application stages."
          points={[
            "Stage 1: Roster link counts in batch-wide statistics",
            "Stage 2: Optional opt-in for named student visibility",
            "Cohorts under 10 students show aggregate counts only",
            "Students can adjust sharing preferences anytime",
          ]}
          fragment={<ConsentFragment />}
          stage="gold"
        />
        <SplitRow
          step="04"
          eyebrow="Individual & Cohort Telemetry"
          title="Follow consented students from application to offer."
          body="Support students who share their progress with your desk: inspect their confirmed skills, readiness band, mock interview completion and verified employer hires across the platform."
          points={[
            "View confirmed CVs and readiness bands for opted-in students",
            "Track course and voice interview preparation",
            "Monitor active applications and interview stages",
            "Verified hire records confirmed by both employer & student",
          ]}
          fragment={<StudentSeatDetailFragment />}
          stage="lavender"
          flip
        />
      </SplitRows>

      <FaqList items={COLLEGE_FAQ} group="college-faq" />
      <CtaOpen title="Bring your batch on board" defaultAudience="college" />
    </>
  );
}
