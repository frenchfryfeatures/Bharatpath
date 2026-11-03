import type { Metadata } from "next";

import { AppDownload } from "@/components/app-download";
import { AudienceShowcase } from "@/components/audience-showcase";
import { CtaOpen } from "@/components/cta-open";
import { FaqList } from "@/components/faq-list";
import { FeatureList, FeatureModule } from "@/components/feature-module";
import { HeroSearch } from "@/components/fragments/hero-search";
import { HowItWorks } from "@/components/how-it-works";
import { PageHero } from "@/components/page-hero";
import { BandDemo, LanguagesDemo, MaskedContactDemo, NoExportDemo, ViewedByDemo } from "@/components/trust-demos";
import { GENERAL_FAQ } from "@/content/faq";

export const metadata: Metadata = {
  title: { absolute: "BharatPath · Jobs, hiring and campus placements across India" },
  alternates: { canonical: "/" },
};

export default function HomePage() {
  return (
    <>
      <PageHero
        lines={["Work for every", "corner of Bharat."]}
        lead="Find a role near you, hire from a workshop of twelve to a chain of forty stores, and bring your college's students to employers who are hiring now."
        primary={{ href: "/jobs/", label: "Find jobs" }}
        secondary={{ href: "/employers/", label: "Hire talent" }}
        fragment={<HeroSearch />}
      />

      <section aria-label="Why BharatPath" className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:px-10 lg:py-36">
        <p data-reveal className="max-w-[30ch] text-[24px] font-medium leading-[1.25] tracking-[-0.02em] sm:text-[36px]">
          Most hiring in India happens in small businesses, in smaller towns, in languages other than English.{" "}
          <span className="text-muted">BharatPath is built for that hiring, and for the people doing it.</span>
        </p>
      </section>

      <AudienceShowcase />

      <HowItWorks />

      <FeatureList id="trust-heading" heading="Built so people trust it">
        <FeatureModule demo={<MaskedContactDemo />} title="Contact details stay private until they matter">
          <p>Search cards show a name, skills, city and experience. A phone number and email appear only when an employer opens the full profile.</p>
          <p>Every open is recorded, with hourly and daily limits.</p>
        </FeatureModule>
        <FeatureModule demo={<ViewedByDemo />} title="Candidates see who looked">
          <p>Your profile lists the organisations that opened it in the last 90 days.</p>
          <p>Nobody browses you without leaving a trace.</p>
        </FeatureModule>
        <FeatureModule demo={<BandDemo />} title="A band, not a verdict">
          <p>Employers see where a resume sits in one of four bands, worked out from what the CV shows and what the candidate confirmed.</p>
        </FeatureModule>
        <FeatureModule demo={<NoExportDemo />} title="No spreadsheets of people">
          <p>There is no bulk download of candidates and no export button. Details are not passed around once they are seen.</p>
        </FeatureModule>
        <FeatureModule demo={<LanguagesDemo />} title="In the language you think in">
          <p>Six languages throughout the app and nine for the essentials, so a first job search does not start with a translation.</p>
        </FeatureModule>
      </FeatureList>

      <AppDownload />

      <FaqList items={GENERAL_FAQ} group="home-faq" />

      <CtaOpen />
    </>
  );
}
