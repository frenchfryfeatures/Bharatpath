import type { Metadata } from "next";
import { Building2, Check, Factory, HeartPulse, Rocket, Store, X } from "lucide-react";

import { CtaOpen } from "@/components/marketing/cta-open";
import { FaqList } from "@/components/marketing/faq-list";
import { CandidateCard } from "@/components/marketing/fragments/candidate-card";
import {
  PipelineFragment,
  PostJobFragment,
  ShortlistInviteFragment,
  TeamFragment,
} from "@/components/marketing/fragments/misc";
import { PageHero } from "@/components/marketing/page-hero";
import { SplitRow, SplitRows } from "@/components/marketing/split-rows";
import { SectionHeading } from "@/components/marketing/ui";
import { EMPLOYER_FAQ } from "@/content/faq";

export const metadata: Metadata = {
  title: "Hire on BharatPath",
  description:
    "Post roles, search confirmed candidates by skill, city and readiness band, and move applicants to hired. Built for MSMEs, startups and large employers across India.",
  alternates: { canonical: "/employers/" },
};

const WHO = [
  {
    icon: Factory,
    name: "MSMEs, plants & workshops",
    line: "Hire machine operators, quality inspectors, shift supervisors or an accountant who knows Tally and GST.",
    examples: "Rajkot · Pune · Ludhiana · Coimbatore",
  },
  {
    icon: Store,
    name: "Retail, logistics & services",
    line: "Staff stores, warehouses, service centres and regional branches city by city, in the local language.",
    examples: "Indore · Jaipur · Lucknow · Kochi",
  },
  {
    icon: Rocket,
    name: "Startups & growing teams",
    line: "Find interns, analysts and early hires who can do the work, evaluated on skills and readiness rather than pedigree.",
    examples: "Bengaluru · Hyderabad · Noida · Mumbai",
  },
  {
    icon: HeartPulse,
    name: "Hospitals, clinics & schools",
    line: "Reach staff nurses, lab technicians, teachers and front-desk coordinators outside the metro job boards.",
    examples: "Nagpur · Patna · Bhubaneswar · Mysuru",
  },
  {
    icon: Building2,
    name: "Enterprises & multi-state chains",
    line: "Run volume hiring and campus intake across dozens of cities with role-based permissions for your whole team.",
    examples: "Pan-India multi-branch teams",
  },
];

const COMPARISONS = [
  {
    topic: "Candidate CVs",
    oldWay: "Unverified PDFs stuffed with hidden keywords and unparsed formatting.",
    newWay: "Every candidate confirms extracted skills and history before scoring; automated checks filter out hidden-text gaming.",
  },
  {
    topic: "Shortlisting speed",
    oldWay: "Reading 200 raw resumes to find 5 people who actually meet the basics.",
    newWay: "Filter immediately by skill, city, experience and four clear Readiness Bands (Entry, Developing, Solid, Strong) plus custom screening questions.",
  },
  {
    topic: "Database access & pricing",
    oldWay: "Complex per-CV unlock wallets, surprise overages, or leaked spreadsheets.",
    newWay: "One simple period subscription gives your team search and profile opens within transparent hourly and daily fairness limits.",
  },
  {
    topic: "Pipeline & offer tracking",
    oldWay: "Stale applicants sitting in spreadsheets with no way to confirm who joined.",
    newWay: "A single stage board with direct candidate messaging, shortlist invitations, 30-day inactivity cleanup and mutual hire confirmation.",
  },
];

const ONBOARDING_STEPS = [
  {
    step: "Step 1",
    title: "Create your business workspace",
    body: "Sign up with your work email, set up your organisation's public profile and invite your recruiters or viewers — free before you pay.",
  },
  {
    step: "Step 2",
    title: "Complete business verification & plan",
    body: "Submit your statutory business details (KYB) and activate your subscription period to unlock job publishing and candidate search.",
  },
  {
    step: "Step 3",
    title: "Post roles or search & invite",
    body: "Publish roles with custom screening questions, or search the candidate pool by skill and readiness band and send direct Shortlist Invitations.",
  },
  {
    step: "Step 4",
    title: "Message, interview and confirm hire",
    body: "Move candidates from Viewed to Shortlisted, Interview and Offered. Message them directly on the board and record mutually confirmed hires.",
  },
];

export default function EmployersPage() {
  return (
    <>
      <PageHero
        lines={["Hire the people", "your business needs."]}
        lead="Whether you run a twelve-person unit in Rajkot or a chain across six states, post a role, search candidates by skill, city and readiness band, and move people from applied to hired on one board."
        primary={{ href: "/signup/employer/", label: "Create business account" }}
        secondary={{ href: "/login?as=employer", label: "Employer sign in" }}
        fragment={<CandidateCard band={2} />}
        stage="purple"
      />

      {/* Sector Playbooks */}
      <section aria-labelledby="who-hires" className="shell pt-12 sm:pt-20">
        <SectionHeading
          id="who-hires"
          title="Built for every kind of employer in Bharat"
          lead="Most hiring in India happens in MSMEs and regional hubs. The tools here cost a small business the same few minutes they cost a national enterprise."
        />
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {WHO.map(({ icon: Icon, name, line, examples }, i) => (
            <div
              key={name}
              data-reveal
              className={`flex flex-col justify-between rounded-[24px] p-6 sm:last:col-span-2 lg:last:col-span-1 ${
                i === 0 ? "bg-purple text-white" : "border border-line bg-paper shadow-card"
              }`}
            >
              <div>
                <span
                  className={`grid h-10 w-10 place-items-center rounded-xl ${
                    i === 0 ? "bg-white/15 text-white" : "bg-lavender text-purple"
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <dt className="mt-4 text-[18px] font-bold leading-snug tracking-[-0.02em]">{name}</dt>
                <dd className={`mt-2 text-[14px] leading-relaxed ${i === 0 ? "text-white/85" : "text-muted"}`}>
                  {line}
                </dd>
              </div>
              <p
                className={`mt-5 border-t pt-3 text-[12px] font-medium ${
                  i === 0 ? "border-white/15 text-white/85" : "border-line text-muted"
                }`}
              >
                {examples}
              </p>
            </div>
          ))}
        </dl>
      </section>

      {/* Old Way vs BharatPath Way Comparison */}
      <section aria-labelledby="why-switch" className="shell py-16 sm:py-24">
        <SectionHeading
          id="why-switch"
          title="Why hiring teams switch from traditional job boards"
          lead="Stop paying per resume just to sort through unverified PDFs. BharatPath gives you structured signal before you open a single profile."
        />
        <div className="grid gap-4 md:grid-cols-2">
          {COMPARISONS.map((c) => (
            <div key={c.topic} data-reveal className="rounded-[24px] border border-line bg-paper p-6 shadow-card sm:p-7">
              <p className="text-[13px] font-semibold uppercase tracking-wider text-purple">{c.topic}</p>
              <div className="mt-4 space-y-3">
                <div className="flex items-start gap-3 rounded-2xl bg-sand p-3.5 text-[14px] text-muted">
                  <X className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                  <span>
                    <strong className="font-semibold text-body">Traditional boards: </strong>
                    {c.oldWay}
                  </span>
                </div>
                <div className="flex items-start gap-3 rounded-2xl bg-lavender p-3.5 text-[14px] text-ink">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-purple-deep" strokeWidth={3} aria-hidden="true" />
                  <span>
                    <strong className="font-semibold text-purple-deep">BharatPath: </strong>
                    {c.newWay}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Capabilities SplitRows — zero duplicate fragments */}
      <SplitRows
        id="employer-how"
        eyebrow="Hiring Workspace"
        heading="How hiring works on BharatPath"
        lead="From your first role post to a mutually confirmed hire, every step happens inside one structured workspace."
      >
        <SplitRow
          step="01"
          eyebrow="Structured Job Composer"
          title="Post a role with screening questions in minutes."
          body="Define the job title, city, work mode, monthly pay band and minimum readiness threshold. Add custom screening questions so applicants sort themselves before you open a single CV."
          points={[
            "Public or unlisted invite-only job postings",
            "Custom screening questions for instant filtering",
            "Minimum readiness band threshold with live preview",
            "Zero age or gender fields by platform design",
          ]}
          fragment={<PostJobFragment />}
          stage="lavender"
        />
        <SplitRow
          step="02"
          eyebrow="Masked Discovery & Direct Shortlist"
          title="Open verified profiles and invite directly to your shortlist."
          body="Browse candidates by confirmed skills, city, experience and readiness band. When you open a profile, you get their phone, email and confirmed CV — and can send a Shortlist Invitation that fast-tracks accepted candidates straight to your board."
          points={[
            "Filter by skill, city, experience & Readiness Band",
            "Full phone, email & confirmed CV on profile open",
            "Save candidates or send direct Shortlist Invitations",
            "Automated integrity checks hide manipulated CVs",
          ]}
          fragment={<ShortlistInviteFragment />}
          stage="purple"
          flip
        />
        <SplitRow
          step="03"
          eyebrow="Live Hiring Pipeline"
          title="Move and message applicants on one live board."
          body="Track every candidate across Viewed, Shortlisted, Interview and Offered. Send in-stage messages and video interview links directly from the application card, and finalize hires with two-sided confirmation."
          points={[
            "Clear stage progression from Viewed to Hired",
            "Built-in candidate messaging & interview links",
            "Two-sided hire confirmation by employer & candidate",
            "Automatic 30-day cleanup of inactive applications",
          ]}
          fragment={<PipelineFragment />}
          stage="gold"
        />
        <SplitRow
          step="04"
          eyebrow="Role-Based Team Access"
          title="Share the workload across your hiring team."
          body="Invite recruiters who can post roles, search candidates and move applicants through stages, plus viewers who can inspect pipelines without making changes. The organisation owner stays in charge."
          points={[
            "Owner, Recruiter and read-only Viewer roles",
            "Invite colleagues by work email in one click",
            "Immediate access revocation when team members change",
            "Complete audit trail across your organisation",
          ]}
          fragment={<TeamFragment />}
          stage="lavender"
          flip
        />
      </SplitRows>

      {/* 4-Step Employer Onboarding Flow */}
      <section aria-labelledby="employer-steps" className="bg-sand py-16 sm:py-24">
        <div className="shell">
          <SectionHeading
            id="employer-steps"
            title="From sign-up to your first shortlist in four steps"
            lead="Set up your organisation and team for free. Activate your plan when you are ready to publish roles and open candidate profiles."
          />
          <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {ONBOARDING_STEPS.map((s) => (
              <li key={s.step} data-reveal className="flex flex-col justify-between rounded-[24px] border border-line bg-paper p-6 shadow-card">
                <div>
                  <span className="inline-flex rounded-full bg-lavender px-3 py-1 text-[13px] font-semibold text-purple-deep">
                    {s.step}
                  </span>
                  <h3 className="mt-4 text-[20px] font-bold leading-snug tracking-[-0.02em]">{s.title}</h3>
                  <p className="mt-2.5 text-[15px] leading-relaxed text-muted">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <FaqList items={EMPLOYER_FAQ} group="employer-faq" />
      <CtaOpen title="Make your next hire" defaultAudience="employer" />
    </>
  );
}
