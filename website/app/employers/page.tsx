import type { Metadata } from "next";

import { CtaOpen } from "@/components/cta-open";
import { FaqList } from "@/components/faq-list";
import { CandidateCard } from "@/components/fragments/candidate-card";
import { PipelineFragment, PostJobFragment, TeamFragment } from "@/components/fragments/misc";
import { PageHero } from "@/components/page-hero";
import { SplitRow, SplitRows } from "@/components/split-rows";
import { EMPLOYER_FAQ } from "@/content/faq";
import { SectionHeading } from "@/components/ui";

export const metadata: Metadata = {
  title: "Hire on BharatPath",
  description: "Post roles, search candidates by skill and city, and move applicants to hired. Built for MSMEs, startups and large employers across India.",
  alternates: { canonical: "/employers/" },
};

const WHO = [
  { name: "MSMEs and workshops", line: "Hire your first supervisor, an accountant who knows Tally, or a shift of operators." },
  { name: "Retail and services", line: "Staff stores, service centres and branches city by city, in the local language." },
  { name: "Startups", line: "Find interns and early hires who can do the work, not only the ones with a famous degree." },
  { name: "Hospitals, schools, non-profits", line: "Reach nurses, teachers and field staff outside the metro job boards." },
  { name: "Large enterprises", line: "Run campus hiring and volume roles across many cities with one team." },
];

export default function EmployersPage() {
  return (
    <>
      <PageHero
        lines={["Hire the people", "your business needs."]}
        lead="Whether you run a twelve-person unit in Rajkot or a chain across six states, post a role, search by skill and city, and move people from applied to hired on one board."
        primary={{ href: "/signup/employer/", label: "Create business account" }}
        secondary={{ href: "/login/employer/", label: "Employer sign in" }}
        fragment={<CandidateCard band={2} />}
        stage="purple"
      />

      <section aria-labelledby="who-hires" className="shell pt-10 sm:pt-16">
        <SectionHeading id="who-hires" title="Built for every kind of employer" lead="Most hiring in India happens in MSMEs. The tools here cost a small business the same few minutes they cost a large one." />
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:gap-4">
          {WHO.map((w, i) => (
            <div key={w.name} data-reveal className={`rounded-[24px] p-6 ${i === 0 ? "bg-purple text-white" : "border border-line bg-paper shadow-card"}`}>
              <dt className="text-[18px] font-bold leading-snug tracking-[-0.02em]">{w.name}</dt>
              <dd className={`mt-2 text-[15px] ${i === 0 ? "text-white/80" : "text-muted"}`}>{w.line}</dd>
            </div>
          ))}
        </dl>
      </section>

      <SplitRows id="employer-how" heading="How hiring works here">
        <SplitRow
          title="Post a role in minutes."
          body="Title, city, pay and what the work is. Add screening questions to sort applicants before you read a single CV."
          fragment={<PostJobFragment />}
        />
        <SplitRow
          title="Search people, not piles of CVs."
          body="Filter by skill, city and experience. Cards show the name, skills and a band; open the profile you want for the phone, email and CV."
          fragment={<CandidateCard band={3} />}
          stage="purple"
        />
        <SplitRow
          title="Move applicants on one board."
          body="Viewed, shortlisted, interview, decision. Message applicants at each stage. A hire is confirmed by both sides."
          fragment={<PipelineFragment />}
        />
        <SplitRow
          title="Share the work with your team."
          body="Add recruiters to post roles and move applicants, and viewers who can only look. The owner stays in charge."
          fragment={<TeamFragment />}
          stage="purple"
        />
      </SplitRows>

      <FaqList items={EMPLOYER_FAQ} group="employer-faq" />
      <CtaOpen title="Make your next hire" />
    </>
  );
}
