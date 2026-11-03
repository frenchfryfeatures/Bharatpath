import type { Metadata } from "next";

import { AppDownload } from "@/components/app-download";
import { CtaOpen } from "@/components/cta-open";
import { FaqList } from "@/components/faq-list";
import { ApplicationTracker } from "@/components/fragments/application-tracker";
import { InterviewFragment, ConsentFragment } from "@/components/fragments/misc";
import { ResumeReview, ResumeUpload } from "@/components/fragments/resume-review";
import { PageHero } from "@/components/page-hero";
import { SplitRow, SplitRows } from "@/components/split-rows";
import { ViewedByDemo } from "@/components/trust-demos";
import { STUDENT_FAQ } from "@/content/faq";

export const metadata: Metadata = {
  title: "For students and job seekers",
  description: "Build or upload your CV, check what we read, apply to roles across India and follow every application. In your language.",
  alternates: { canonical: "/students/" },
};

export default function StudentsPage() {
  return (
    <>
      <PageHero
        lines={["Your first job,", "or your next one."]}
        lead="Freshers, ITI and diploma holders, graduates and people changing careers: put your CV in front of employers who are hiring near you, and see exactly what happens next."
        primary={{ href: "/signup/student/", label: "Create free account" }}
        secondary={{ href: "/jobs/", label: "Browse jobs" }}
        fragment={<ApplicationTracker reached={2} title="Staff nurse" org="Multi-speciality hospital · Nagpur" />}
      />

      <SplitRows id="students-how" heading="What you get">
        <SplitRow
          title="A CV that works, even if you have never written one."
          body="Upload the one you have, or build one from four clean templates using your answers. Download it as a PDF whenever you like."
          fragment={<ResumeUpload />}
        />
        <SplitRow
          title="You check it before anyone scores it."
          body="We show you every line we read from your CV. Fix what is wrong, then confirm. A misread never turns into your score."
          fragment={<ResumeReview />}
          stage="navy"
        />
        <SplitRow
          title="Practise interviews out loud."
          body="Answer spoken questions written for your CV, in your language, and get feedback on each answer. Practice is for you; it never moves your score."
          fragment={<InterviewFragment />}
        />
        <SplitRow
          title="Know who opened your profile."
          body="Employers see your skills and band on a search card. Your phone, email and CV appear only when they open your full profile, and you see which organisations did."
          fragment={<div className="w-full max-w-[400px]"><ViewedByDemo /></div>}
        />
        <SplitRow
          title="Linked to your college, if you want."
          body="If your college is on BharatPath, join with its code. It counts you in its placement figures; it sees you by name only if you choose to share."
          fragment={<ConsentFragment />}
          stage="navy"
        />
      </SplitRows>

      <AppDownload />
      <FaqList items={STUDENT_FAQ} group="student-faq" />
      <CtaOpen title={["Your path", "starts here."]} />
    </>
  );
}
