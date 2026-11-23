"use client";

import Link from "next/link";
import { useRef } from "react";
import { ArrowLeft, ArrowRight } from "lucide-react";

import type { RecommendedJobs } from "@/features/student/types";
import { EmptyState, JobCard, StudentErrorState } from "@/features/student/components";
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
  const result = useGetJobsSimilarToAppliedQuery({ limit: fullPage ? 50 : 12 });
  return <RecommendationSection kind="similar-to-applied" fullPage={fullPage} result={result} />;
}

export function MatchingProfileJobs({ fullPage = false }: { fullPage?: boolean }) {
  const result = useGetJobsMatchingProfileQuery({ limit: fullPage ? 50 : 12 });
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
  const railRef = useRef<HTMLDivElement>(null);
  const href = `/student/recommended-jobs/${kind}`;
  const content = (
    <section className="flex flex-col gap-3" aria-label={section.title}>
      {fullPage ? (
        <div className="flex flex-col gap-2">
          <StudentTopBar title={section.title} backHref="/student" className="mb-1" />
          <p className="text-[13px] text-[#5F6B80]">{section.description}</p>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-[18px] font-semibold leading-6 tracking-[-0.02em] text-[#0A1931]">{section.title}</h2>
          {result.data?.hasBasis && result.data.items.length > 0 && <Link href={href} className="flex shrink-0 items-center gap-1 rounded-full border border-[#DDD6C7] bg-white px-3 py-2 text-[12px] font-semibold text-[#0A1931] hover:bg-[#F7F4EC]">See more jobs <ArrowRight size={13}/></Link>}
        </div>
      )}

      {result.isLoading ? (
        <StudentJobGridSkeleton count={fullPage ? 6 : 3} label={`Loading ${section.title}`} />
      ) : result.error && !result.data ? (
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
        <div className="min-w-0"><div className="mb-2 flex justify-end gap-2">{([-1, 1] as const).map(direction => <button key={direction} type="button" aria-label={`Scroll ${section.title} ${direction < 0 ? 'left' : 'right'}`} onClick={() => railRef.current?.scrollBy({ left: direction * (railRef.current.clientWidth || 340), behavior: 'smooth' })} className="grid h-10 w-10 place-items-center rounded-full border border-[#E7E0D4] bg-white text-[#5F4DB2] hover:bg-[#F1EAF7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30">{direction < 0 ? <ArrowLeft size={17}/> : <ArrowRight size={17}/>}</button>)}</div>
        <div ref={railRef} tabIndex={0} aria-label={`${section.title}, scroll horizontally for more jobs`} className="flex snap-x snap-proximity gap-3 overflow-x-auto overscroll-x-contain pb-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30">
          {result.data.items.map((job) => (
            <div key={job.id} className="w-[min(85vw,340px)] shrink-0 snap-start [&>div]:h-full"><JobCard job={job} matchedSkills={job.matchedSkills} matchReasons={job.matchReasons} /></div>
          ))}
        </div>
        </div>
      ) : (
        <EmptyState title="No matching jobs right now" message="Check back as new jobs are posted." />
      )}

    </section>
  );

  return fullPage ? <StudentPage>{content}</StudentPage> : content;
}
