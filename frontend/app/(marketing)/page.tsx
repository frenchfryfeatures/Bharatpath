import type { Metadata } from "next";

import { AppDownload } from "@/components/marketing/app-download";
import { AudienceBand } from "@/components/marketing/audience-band";
import { CtaOpen } from "@/components/marketing/cta-open";
import { FaqList } from "@/components/marketing/faq-list";
import { CandidateCard } from "@/components/marketing/fragments/candidate-card";
import { CohortPanel } from "@/components/marketing/fragments/cohort-panel";
import { HeroPreview } from "@/components/marketing/fragments/hero-search";
import { Categories, Cities, Doors, FeaturedJobs } from "@/components/marketing/home-sections";
import { PageHero } from "@/components/marketing/page-hero";
import { SearchBar } from "@/components/marketing/search-bar";
import { Steps } from "@/components/marketing/steps";
import { TrustGrid } from "@/components/marketing/trust-grid";
import { GENERAL_FAQ } from "@/content/faq";

export const metadata: Metadata = {
  title: { absolute: "BharatPath · Jobs, hiring and campus placements across India" },
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <PageHero
        lines={["Work for every", "corner of Bharat"]}
        lead="Find a role near you, hire from a workshop of twelve to a chain of forty stores, and bring your college's students to employers hiring now."
        fragment={<HeroPreview />}
      >
        <div className="mt-8">
          <SearchBar />
        </div>
      </PageHero>

      <Doors />
      <Categories />
      <FeaturedJobs />
      <Cities />
      <Steps />

      <AudienceBand
        id="emp-band"
        title="Hiring? Start in minutes, whatever your size"
        lead="Built as much for a twelve-person workshop in Rajkot as for a chain across six states."
        points={[
          "Post roles with screening questions",
          "Search by skill, city, experience and readiness band",
          "Open only the profiles you need or invite to shortlist",
          "Move applicants from viewed to hired on one board",
        ]}
        primary={{ href: "/signup/employer/", label: "Create business account" }}
        secondary={{ href: "/employers/", label: "How hiring works" }}
        fragment={<CandidateCard />}
      />
      <AudienceBand
        id="col-band"
        title="Colleges: a placement desk that never closes"
        lead="Engineering, commerce, polytechnic, ITI or nursing: give every student a place to find work."
        points={[
          "Invite students with one referral code or roster CSV",
          "Cover their access with your college seats",
          "Follow your batch from linked to hired",
          "See a student by name only when they choose to share",
        ]}
        primary={{ href: "/signup/college/", label: "Register your college" }}
        secondary={{ href: "/colleges/", label: "How it works for colleges" }}
        fragment={<CohortPanel />}
        tone="gold"
        flip
      />

      <TrustGrid />
      <AppDownload />
      <FaqList items={GENERAL_FAQ} group="home-faq" />
      <CtaOpen />
    </>
  );
}
