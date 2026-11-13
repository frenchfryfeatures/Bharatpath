import type { Metadata } from "next";
import { Check, Compass, GraduationCap, HeartPulse, Wrench } from "lucide-react";

import { AppDownload } from "@/components/marketing/app-download";
import { CtaOpen } from "@/components/marketing/cta-open";
import { FaqList } from "@/components/marketing/faq-list";
import { ApplicationTracker } from "@/components/marketing/fragments/application-tracker";
import {
  AssistantFragment,
  InterviewFragment,
  ReadinessProfileFragment,
  StreakFragment,
} from "@/components/marketing/fragments/misc";
import { ResumeReview, ResumeUpload } from "@/components/marketing/fragments/resume-review";
import { PageHero } from "@/components/marketing/page-hero";
import { SplitRow, SplitRows } from "@/components/marketing/split-rows";
import { ViewedByDemo } from "@/components/marketing/trust-demos";
import { SectionHeading } from "@/components/marketing/ui";
import { STUDENT_FAQ } from "@/content/faq";

export const metadata: Metadata = {
  title: "For students and job seekers",
  description:
    "Build or upload your CV, check what we read, strengthen your readiness profile, apply to roles across India and follow every application. In your language.",
  alternates: { canonical: "/students/" },
};

const PERSONAS = [
  {
    icon: GraduationCap,
    title: "Fresh graduates & final-year students",
    body: "Turn your degree, projects and internships into a clean, structured CV. Link with your college's referral code or start on your own.",
    roles: "Accounts, analyst, sales, operations, trainee",
  },
  {
    icon: Wrench,
    title: "ITI, polytechnic & diploma holders",
    body: "Show your hands-on trade skills, machines operated and certifications clearly to workshops, plants and service centres near you.",
    roles: "CNC operator, quality inspector, technician, fitter",
  },
  {
    icon: HeartPulse,
    title: "Healthcare, retail & field professionals",
    body: "Find verified openings at hospitals, diagnostic chains, schools, logistics hubs and stores across Tier-1, Tier-2 and Tier-3 cities.",
    roles: "Staff nurse, lab technician, store supervisor, field exec",
  },
  {
    icon: Compass,
    title: "Experienced workers & career switchers",
    body: "Highlight your real work history and skills rather than just your first degree. Keep your contact details masked until an employer opens your profile.",
    roles: "Shift supervisor, team lead, branch operations",
  },
];

const READINESS_CRUX = [
  {
    title: "You approve your CV before any score exists",
    body: "Nothing is scored behind your back. You review every line we read from your CV and confirm it first, so a typo or scan error never defines you.",
  },
  {
    title: "Employers see your readiness band, not a raw number",
    body: "On search cards, employers see one of four readiness bands — Entry, Developing, Solid or Strong — alongside your confirmed skills and city.",
  },
  {
    title: "Active preparation strengthens your profile",
    body: "Your readiness profile reflects your confirmed CV and grows as you complete the career-readiness course and voice mock interview sessions.",
  },
  {
    title: "Merit and skills first, always",
    body: "Your profile carries no age, no gender and no photograph on employer search cards. You are discovered for what you can do.",
  },
];

const FREE_ITEMS = [
  "Create your candidate account in 9 Indian languages",
  "Upload an existing PDF or Word CV (including scanned CVs)",
  "Build a clean CV from 4 professional templates & download as PDF",
  "Review and edit every extracted detail before confirmation",
  "Link to your college via referral code or invitation",
  "Track or withdraw your existing job applications anytime",
  "Browse the official Government Jobs Bulletin",
];

const UNLOCKED_ITEMS = [
  "Generate and refresh your Readiness Profile & Band",
  "Apply in one tap to verified roles across India",
  "Use the conversational AI Job-Search Assistant",
  "See which employers opened your profile in the last 90 days",
  "Receive direct Shortlist Invitations from hiring teams",
  "Access the career-readiness course and voice mock interviews (add-ons)",
];

export default function StudentsPage() {
  return (
    <>
      <PageHero
        lines={["Your first job,", "or your next one."]}
        lead="Freshers, ITI and diploma holders, graduates and people changing careers: put a verified CV in front of employers hiring near you, strengthen your readiness profile, and see every stage of every application."
        primary={{ href: "/signup/student/", label: "Create free account" }}
        secondary={{ href: "/jobs/", label: "Browse jobs" }}
        fragment={<ApplicationTracker reached={2} title="Staff nurse" org="Multi-speciality hospital · Nagpur" />}
        stage="purple"
      />

      {/* Who thrives on BharatPath */}
      <section aria-labelledby="who-students" className="shell pt-12 sm:pt-20">
        <SectionHeading
          id="who-students"
          title="Built for every path into work"
          lead="Whether you are stepping out of a classroom, an ITI workshop or moving to your next role, BharatPath puts your practical skills front and centre."
        />
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PERSONAS.map(({ icon: Icon, title, body, roles }, i) => (
            <li
              key={title}
              data-reveal
              className={`flex flex-col justify-between rounded-[24px] p-6 ${
                i === 0 ? "bg-purple text-white" : "border border-line bg-paper shadow-card"
              }`}
            >
              <div>
                <span
                  className={`grid h-11 w-11 place-items-center rounded-xl ${
                    i === 0 ? "bg-white/15 text-white" : "bg-lavender text-purple"
                  }`}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-[19px] font-bold leading-snug tracking-[-0.02em]">{title}</h3>
                <p className={`mt-2.5 text-[15px] ${i === 0 ? "text-white/85" : "text-muted"}`}>{body}</p>
              </div>
              <p
                className={`mt-6 border-t pt-3 text-[13px] font-medium ${
                  i === 0 ? "border-white/15 text-white/90" : "border-line text-body"
                }`}
              >
                Common roles: {roles}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* Dedicated Section: Understand Your Readiness Profile */}
      <section aria-labelledby="readiness-heading" className="shell py-16 sm:py-24">
        <div className="rounded-[28px] border border-lilac-line bg-lavender p-6 sm:p-10 lg:p-14">
          <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
            <div>
              <span className="inline-flex items-center rounded-full bg-paper px-3.5 py-1 text-[13px] font-semibold text-purple-deep">
                Candidate Readiness Profile
              </span>
              <h2
                id="readiness-heading"
                className="mt-4 text-[28px] font-bold leading-[1.08] tracking-[-0.03em] sm:text-[38px]"
              >
                Understand your Readiness Profile
              </h2>
              <p className="mt-4 max-w-[56ch] text-[16px] text-body sm:text-[17px]">
                Most job boards leave your CV in a pile of thousands. BharatPath turns your confirmed experience, skills and preparation into a clear readiness profile on a three-digit scale — so employers can spot capable candidates across any industry or city.
              </p>
              <dl className="mt-8 grid gap-4 sm:grid-cols-2">
                {READINESS_CRUX.map((item) => (
                  <div key={item.title} className="rounded-[20px] bg-paper p-5 shadow-card">
                    <dt className="text-[16px] font-bold leading-snug tracking-[-0.015em] text-ink">{item.title}</dt>
                    <dd className="mt-2 text-[14px] leading-relaxed text-muted">{item.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <div className="flex justify-center">
              <ReadinessProfileFragment />
            </div>
          </div>
        </div>
      </section>

      {/* Capabilities SplitRows */}
      <SplitRows
        id="students-how"
        eyebrow="Candidate Toolkit"
        heading="Everything you need to find work and get hired"
        lead="Every tool is designed to work smoothly on your phone or browser in nine Indian languages — from building your first CV to confirming a job offer."
      >
        <SplitRow
          step="01"
          eyebrow="Resume Builder & Upload"
          title="A professional CV that works, even if you have never written one."
          body="Upload the PDF or Word CV you already have — even a phone scan — or build a clean one from four templates using your onboarding answers. Download a crisp PDF anytime at no cost."
          points={[
            "PDF & Word uploads (up to 10 pages)",
            "4 clean templates: Classic, Modern, Compact, Two-column",
            "Automatic OCR fallback for scanned CVs",
            "Free PDF downloads whenever you need",
          ]}
          fragment={<ResumeUpload />}
          stage="lavender"
        />
        <SplitRow
          step="02"
          eyebrow="The Confirm Gate"
          title="You inspect and approve every line before anything is scored."
          body="Automated resume parsers on ordinary job sites make silent mistakes. On BharatPath, you see every skill, role and qualification we read from your CV, edit anything that looks off, and confirm it yourself."
          points={[
            "Nothing is scored without your confirmation",
            "Edit extracted skills, roles and education inline",
            "Unlimited uploads and draft edits anytime",
            "Confirm a fresh version for scoring every 15 days",
          ]}
          fragment={<ResumeReview />}
          stage="purple"
          flip
        />
        <SplitRow
          step="03"
          eyebrow="Voice Mock Interviews"
          title="Practise spoken interviews tailored to your CV, in your language."
          body="Hear interview questions written specifically for your confirmed CV spoken out loud. Record your answers by voice to strengthen your readiness profile and get structured feedback on every answer."
          points={[
            "Questions spoken aloud in your chosen language",
            "Tailored to your actual CV — no repeated questions",
            "Feedback levels: Strong, Developing, Focus Area",
            "Zero penalty for regional accent or speaking speed",
          ]}
          fragment={<InterviewFragment />}
          stage="gold"
        />
        <SplitRow
          step="04"
          eyebrow="Job-Search Assistant"
          title="Find matching openings by chatting with your assistant."
          body="Skip complex filter menus. Tell the assistant the role, city, work mode or pay you want, and it surfaces matching jobs you have not applied to yet while checking if they are open to you."
          points={[
            "Search by skill, title, city, work mode and salary",
            "Automatically hides roles you already applied to",
            "Shows clear eligibility status before you apply",
            "You stay in control and confirm every application",
          ]}
          fragment={<AssistantFragment />}
          stage="lavender"
          flip
        />
        <SplitRow
          step="05"
          eyebrow="Privacy & Profile Views"
          title="Know exactly which employers opened your profile."
          body="Your phone number, email and full CV never sit exposed on public search cards. Employers see your readiness band and skills first, and when a verified employer opens your profile, it appears in your 90-day view log."
          points={[
            "Phone, email and CV stay masked on search cards",
            "90-day log of organisations that opened your profile",
            "Receive direct Shortlist Invitations from employers",
            "Live stage tracking from Submitted to Hired",
          ]}
          fragment={
            <div className="w-full max-w-[420px] rounded-[20px] border border-line bg-paper p-5 shadow-card">
              <p className="mb-3 text-[14px] font-semibold text-ink">Organisations that opened your profile</p>
              <ViewedByDemo />
              <p className="mt-3 text-[12px] text-muted">Showing activity from the last 90 days · Every open is audited</p>
            </div>
          }
          stage="purple"
        />
        <SplitRow
          step="06"
          eyebrow="Daily Streaks & Campus Link"
          title="Build daily preparation habits and link with your college."
          body="Check in daily to build your career streak and earn milestone rewards at 30, 90 and 365 days. And if your college is on BharatPath, link with its code to claim a college-sponsored seat."
          points={[
            "Daily IST check-in calendar & streak milestones",
            "Streak points stay separate from your readiness score",
            "Link with your college code for seat-covered access",
            "Share your name with your college only if you choose",
          ]}
          fragment={<StreakFragment />}
          stage="gold"
          flip
        />
      </SplitRows>

      {/* Free vs Plan / College Seat Clarity */}
      <section aria-labelledby="access-heading" className="bg-sand py-16 sm:py-24">
        <div className="shell">
          <SectionHeading
            id="access-heading"
            title="Start free. Unlock full access with a plan or college seat."
            lead="Building your CV and checking how we read it costs nothing. When you are ready to score and apply, activate a candidate plan — or link a seat sponsored by your college."
          />
          <div className="grid gap-6 lg:grid-cols-2">
            <div data-reveal className="rounded-[24px] border border-line bg-paper p-6 shadow-card sm:p-8">
              <span className="inline-flex rounded-full bg-sand px-3 py-1 text-[13px] font-semibold text-body">
                Always free for everyone
              </span>
              <h3 className="mt-4 text-[24px] font-bold tracking-[-0.025em]">Build, review and explore</h3>
              <ul className="mt-6 space-y-3.5">
                {FREE_ITEMS.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-[15px] text-body">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-green-soft text-green">
                      <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div data-reveal className="rounded-[24px] border border-lilac-line bg-paper p-6 shadow-card sm:p-8">
              <span className="inline-flex rounded-full bg-lavender px-3 py-1 text-[13px] font-semibold text-purple-deep">
                Candidate plan or College seat
              </span>
              <h3 className="mt-4 text-[24px] font-bold tracking-[-0.025em]">Score, apply and get discovered</h3>
              <ul className="mt-6 space-y-3.5">
                {UNLOCKED_ITEMS.map((item) => (
                  <li key={item} className="flex items-start gap-3 text-[15px] text-body">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-purple text-white">
                      <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <AppDownload />
      <FaqList items={STUDENT_FAQ} group="student-faq" />
      <CtaOpen title="Your path starts here" defaultAudience="student" />
    </>
  );
}
