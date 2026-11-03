import type { Metadata } from "next";

import { CtaOpen } from "@/components/cta-open";
import { FaqList } from "@/components/faq-list";
import { CohortPanel } from "@/components/fragments/cohort-panel";
import { ConsentFragment, ReferralFragment } from "@/components/fragments/misc";
import { ApplicationTracker } from "@/components/fragments/application-tracker";
import { PageHero } from "@/components/page-hero";
import { SplitRow, SplitRows } from "@/components/split-rows";
import { COLLEGE_FAQ } from "@/content/faq";

export const metadata: Metadata = {
  title: "For colleges and institutions",
  description: "Bring your students onto BharatPath with a referral code or roster, give them access through your seats, and follow placements across your cohort.",
  alternates: { canonical: "/colleges/" },
};

export default function CollegesPage() {
  return (
    <>
      <PageHero
        lines={["A placement desk", "that never closes."]}
        lead="Engineering, arts, commerce, polytechnic, ITI or nursing: give every student a place to find work, and see how your whole batch is doing through the season."
        primary={{ href: "/signup/college/", label: "Register your college" }}
        secondary={{ href: "/login/college/", label: "College sign in" }}
        fragment={<CohortPanel />}
      />

      <SplitRows id="college-how" heading="How it works for colleges">
        <SplitRow
          title="Bring students on with one code."
          body="Share a referral code in class or on your notice board, or upload a roster and send invitations. Each student joins from their own account."
          fragment={<ReferralFragment />}
        />
        <SplitRow
          title="Your seats cover their access."
          body="Your plan comes with seats. A linked student on one of your seats gets the full platform without paying for a plan of their own."
          fragment={<ApplicationTracker reached={1} title="Accounts assistant" org="Textile exporter · Ludhiana" />}
          stage="navy"
        />
        <SplitRow
          title="Students decide what you see."
          body="Linked students are counted in your figures. You see a student by name, with their applications, only after they choose to share, and they can stop sharing at any time."
          fragment={<ConsentFragment />}
        />
        <SplitRow
          title="Figures you can take to a review."
          body="Applied, shortlisted, interviewed and hired, by cohort. Small groups show counts only, so no number points to one student."
          fragment={<CohortPanel />}
          stage="navy"
        />
      </SplitRows>

      <FaqList items={COLLEGE_FAQ} group="college-faq" />
      <CtaOpen title={["Bring your", "batch on board."]} />
    </>
  );
}
