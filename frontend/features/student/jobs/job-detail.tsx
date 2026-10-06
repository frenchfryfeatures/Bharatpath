"use client";

import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, ExternalLink } from "lucide-react";

import {
  useApplyToStudentJobMutation,
  useGetStudentApplicationsQuery,
  useGetStudentJobQuery,
  useGetStudentJobsQuery,
} from "@/store/student";
import {
  candidateDetailsWithDefaults,
  JobDescriptionView,
} from "@/features/jobs";
import { formatSalary } from "@/features/student/formatters";
import {
  interactiveCardClass,
  PillButton,
  StatusChip,
  StudentCard,
  StudentErrorState,
} from "@/features/student/components";
import { StudentJobDetailSkeleton } from "@/features/student/loading";
import { StudentPage, StudentTopBar } from "@/features/student/shell";
import type { JobListing } from "@/features/student/types";

export function JobDetail() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const job = useGetStudentJobQuery(params.id);
  const applications = useGetStudentApplicationsQuery({ limit: 100 });
  const [apply, applyState] = useApplyToStudentJobMutation();
  const applied = applications.data?.items.some(
    (application) =>
      application.jobId === params.id &&
      !["WITHDRAWN", "REJECTED", "EXPIRED"].includes(application.stage),
  );

  if (job.isLoading) {
    return <StudentJobDetailSkeleton />;
  }

  if (!job.data || job.error) {
    return (
      <StudentPage>
        <StudentErrorState
          title="Job unavailable"
          error={job.error}
          fallback="This job may have been closed."
        />
        <PillButton
          className="mt-4 w-full"
          onClick={() => router.push("/student/jobs")}
        >
          Back to jobs
        </PillButton>
      </StudentPage>
    );
  }

  const listing = job.data;
  const details = listing.details ?? candidateDetailsWithDefaults({});
  const eligible = listing.eligibility === "ELIGIBLE";
  const external =
    details.application.method === "EXTERNAL" &&
    details.application.external_url;

  const submitApplication = async () => {
    try {
      await apply(listing.id).unwrap();
      router.push("/student/board");
    } catch {
      // Mutation state renders the backend-mapped error below.
    }
  };

  const applyButton = applied ? (
    <PillButton
      variant="secondary"
      className="min-w-[180px] !py-3"
      onClick={() => router.push("/student/board")}
    >
      Applied · see my board
    </PillButton>
  ) : (
    <PillButton
      className="min-w-[140px] !py-3"
      disabled={!eligible || applyState.isLoading || applications.isLoading}
      onClick={() => void submitApplication()}
    >
      {applications.isLoading
        ? "Checking applications…"
        : applyState.isLoading
          ? "Applying…"
          : "Apply now"}
    </PillButton>
  );

  return (
    <StudentPage>
      <StudentTopBar title={listing.title} />

      <JobDescriptionView
        tone="student"
        job={{
          title: listing.title,
          employerName: listing.employerName,
          location: listing.location,
          workMode: listing.workMode,
          experienceMinMonths: listing.experienceMinMonths,
          salaryMinMinor: listing.salaryMinMinor,
          salaryMaxMinor: listing.salaryMaxMinor,
          description: listing.description ?? "",
          skills: listing.skills,
          details,
          postedAt: listing.publishedAt,
        }}
        badges={
          <StatusChip
            tone={eligible ? "match" : "waiting"}
            icon={eligible ? <CheckCircle2 size={12} /> : undefined}
          >
            {eligible
              ? "Eligible to apply"
              : listing.eligibility === "SCORE_PENDING"
                ? "Score pending"
                : "Not eligible"}
          </StatusChip>
        }
        actions={
          external ? (
            <>
              <a
                href={details.application.external_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="inline-flex min-w-[140px] items-center justify-center gap-2 rounded-full bg-[#5F4DB2] px-4 py-3 text-[15px] font-semibold leading-5 text-white transition-all hover:bg-[#4A3E8F] active:scale-[.98]"
              >
                Apply on company site
                <ExternalLink size={15} aria-hidden="true" />
              </a>
            </>
          ) : (
            applyButton
          )
        }
        aside={
          <>
            {applyState.error ? (
              <StudentErrorState
                variant="inline"
                error={applyState.error}
                fallback="Could not submit your application."
              />
            ) : null}
            <SimilarJobs
              jobId={listing.id}
              skill={details.skills.primary || listing.skills[0]}
            />
          </>
        }
      />
    </StudentPage>
  );
}

/** Other published jobs asking for this job's main skill. */
function SimilarJobs({
  jobId,
  skill,
}: {
  jobId: string;
  skill: string | undefined;
}) {
  const router = useRouter();
  const similar = useGetStudentJobsQuery(
    { skill, limit: 6 },
    { skip: !skill },
  );
  const jobs = (similar.data?.items ?? [])
    .filter((item) => item.id !== jobId)
    .slice(0, 5);

  if (!skill || (!similar.isLoading && jobs.length === 0)) return null;

  return (
    <StudentCard className="!p-5">
      <h2 className="mb-3 text-[16px] font-bold text-[#0A1931]">
        Jobs you might be interested in
      </h2>
      {similar.isLoading ? (
        <p className="text-[13px] text-[#5F6B80]">Finding similar jobs…</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[#EEE9F3]">
          {jobs.map((item) => (
            <li key={item.id}>
              <SimilarJobRow
                job={item}
                onOpen={() => router.push(`/student/jobs/${item.id}`)}
              />
            </li>
          ))}
        </ul>
      )}
    </StudentCard>
  );
}

function SimilarJobRow({
  job,
  onOpen,
}: {
  job: JobListing;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-col gap-1 rounded-xl px-1 py-3 text-left ${interactiveCardClass} hover:translate-y-0 hover:shadow-none`}
    >
      <span className="text-[14px] font-semibold leading-5 text-[#0A1931]">
        {job.title}
      </span>
      <span className="text-[12px] text-[#5F6B80]">
        {job.employerName ?? "Employer"}
      </span>
      <span className="text-[12px] text-[#3A4761]">
        {[job.location, formatSalary(job)].filter(Boolean).join(" · ")}
      </span>
    </button>
  );
}
