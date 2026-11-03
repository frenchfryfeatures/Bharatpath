import type { Metadata } from "next";

import { AppDownload } from "@/components/app-download";
import { AudienceBand } from "@/components/audience-band";
import { CtaOpen } from "@/components/cta-open";
import { FaqList } from "@/components/faq-list";
import { CandidateCard } from "@/components/fragments/candidate-card";
import { CohortPanel } from "@/components/fragments/cohort-panel";
import { HeroPreview } from "@/components/fragments/hero-search";
import { Categories, Cities, Doors, FeaturedJobs, GovTeaser } from "@/components/home-sections";
import { PageHero } from "@/components/page-hero";
import { SearchBar } from "@/components/search-bar";
import { Steps } from "@/components/steps";
import { TrustGrid } from "@/components/trust-grid";
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
        points={["Post roles with screening questions", "Search by skill, city and experience", "Open only the profiles you need", "Move applicants from viewed to hired on one board"]}
        primary={{ href: "/signup/employer/", label: "Create business account" }}
        secondary={{ href: "/employers/", label: "How hiring works" }}
        fragment={<CandidateCard />}
      />
      <AudienceBand
        id="col-band"
        title="Colleges: a placement desk that never closes"
        lead="Engineering, commerce, polytechnic, ITI or nursing: give every student a place to find work."
        points={["Invite students with one referral code", "Cover their access with your seats", "Follow your batch from linked to hired", "See a student by name only when they share"]}
        primary={{ href: "/signup/college/", label: "Register your college" }}
        secondary={{ href: "/colleges/", label: "How it works for colleges" }}
        fragment={<CohortPanel />}
        tone="gold"
        flip
      />

      <div className="py-10 sm:py-14">
        <GovTeaser />
      </div>
      <TrustGrid />
      <AppDownload />
      <FaqList items={GENERAL_FAQ} group="home-faq" />
      <CtaOpen />
    </>
  );
}
