"use client";

import Link from "next/link";
import { ArrowRight, Briefcase } from "lucide-react";

import type { RecommendedJobs } from "@/features/student/types";
import { EmptyState, JobCard, SectionEyebrow, StudentErrorState } from "@/features/student/components";
import { StudentJobGridSkeleton } from "@/features/student/loading";
import { StudentPage, StudentTopBar } from "@/features/student/shell";
import {
  useGetJobsMatchingProfileQuery,
  useGetJobsSimilarToAppliedQuery,
} from "@/store/student";

type RecommendationKind = "similar-to-applied" | "matching-profile";

const sections = {
  "similar-to-applied": {
    title: "Similar to jobs you applied for",
    description: "Roles related to your recent applications, ranked by how closely they match.",
    basisTitle: "Apply to a job to get recommendations",
    basisMessage: "Once you apply, we can find roles with similar skills, titles and locations.",
    basisHref: "/student/jobs",
    basisAction: "Browse jobs",
  },
  "matching-profile": {
    title: "Jobs relevant to your profile",
    description: "Roles ranked using the skills, experience and preferences in your career profile.",
    basisTitle: "Add your skills to get recommendations",
    basisMessage: "Add a skill or role to your career profile to see matching jobs.",
    basisHref: "/student/profile",
    basisAction: "Update profile",
  },
} as const;

type RecommendationResult = {
  data?: RecommendedJobs;
  isLoading: boolean;
  error?: unknown;
  refetch: () => unknown;
};

export function SimilarToAppliedJobs({ fullPage = false }: { fullPage?: boolean }) {
  const result = useGetJobsSimilarToAppliedQuery({ limit: fullPage ? 50 : 3 });
  return <RecommendationSection kind="similar-to-applied" fullPage={fullPage} result={result} />;
}

export function MatchingProfileJobs({ fullPage = false }: { fullPage?: boolean }) {
  const result = useGetJobsMatchingProfileQuery({ limit: fullPage ? 50 : 3 });
  return <RecommendationSection kind="matching-profile" fullPage={fullPage} result={result} />;
}

function RecommendationSection({
  kind,
  fullPage,
  result,
}: {
  kind: RecommendationKind;
  fullPage: boolean;
  result: RecommendationResult;
}) {
  const section = sections[kind];
  const href = `/student/recommended-jobs/${kind}`;
  const content = (
    <section className="flex flex-col gap-3" aria-label={section.title}>
      {fullPage ? (
        <div className="flex flex-col gap-2">
          <StudentTopBar title={section.title} backHref="/student" className="mb-1" />
          <p className="text-[13px] text-[#5F6B80]">{section.description}</p>
        </div>
      ) : (
        <SectionEyebrow
          icon={<Briefcase size={12} />}
          action={
            result.data?.hasBasis && result.data.items.length > 0 ? (
              <Link
                href={href}
                className="flex shrink-0 items-center gap-1 rounded-full border border-[#DDD6C7] bg-white px-3 py-2 text-[12px] font-semibold text-[#0A1931] transition-colors hover:border-[#CFC6B4] hover:bg-[#F7F4EC]"
              >
                See more jobs <ArrowRight size={13} />
              </Link>
            ) : null
          }
        >
          {section.title}
        </SectionEyebrow>
      )}

      {result.isLoading ? (
        <StudentJobGridSkeleton count={fullPage ? 6 : 3} label={`Loading ${section.title}`} />
      ) : result.error ? (
        <StudentErrorState error={result.error} title="Jobs unavailable" fallback="Could not load recommended jobs." onRetry={result.refetch} />
      ) : !result.data?.hasBasis ? (
        <EmptyState
          title={section.basisTitle}
          message={section.basisMessage}
          action={
            <Link href={section.basisHref} className="inline-block rounded-full bg-[#5F4DB2] px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-[#4A3E8F]">
              {section.basisAction}
            </Link>
          }
        />
      ) : result.data.items.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {result.data.items.map((job) => (
            <JobCard key={job.id} job={job} matchedSkills={job.matchedSkills} />
          ))}
        </div>
      ) : (
        <EmptyState title="No matching jobs right now" message="Check back as new jobs are posted." />
      )}

    </section>
  );

  return fullPage ? <StudentPage>{content}</StudentPage> : content;
}
