"use client";

import { useParams, useRouter } from "next/navigation";
import {
  BriefcaseBusiness,
  CheckCircle2,
  MapPin,
} from "lucide-react";

import {
  useApplyToStudentJobMutation,
  useGetStudentApplicationsQuery,
  useGetStudentJobQuery,
} from "@/store/student";
import {
  employerMonogram,
  formatDate,
  formatSalary,
  workModeLabel,
} from "@/features/student/formatters";
import {
  PillButton,
  SkillChip,
  StatusChip,
  StudentCard,
  StudentErrorState,
} from "@/features/student/components";
import { StudentJobDetailSkeleton } from "@/features/student/loading";
import { StudentPage, StudentTopBar } from "@/features/student/shell";

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
  const eligible = listing.eligibility === "ELIGIBLE";

  const submitApplication = async () => {
    try {
      await apply(listing.id).unwrap();
      router.push("/student/board");
    } catch {
      // Mutation state renders the backend-mapped error below.
    }
  };

  return (
    <StudentPage>
      <StudentTopBar title={listing.title} />

      <div className="flex flex-col gap-4 rounded-[24px] bg-[#5F4DB2] p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/10 text-[16px] font-bold text-[#F4D685]">
            {employerMonogram(listing.employerName)}
          </span>
          <div className="flex flex-col gap-1 pt-1">
            <span className="text-[22px] font-bold leading-7 tracking-[-0.02em] text-white">
              {listing.title}
            </span>
            <span className="text-[13px] text-[#E0DBF4]">
              {listing.employerName ?? "Employer"}
            </span>
          </div>
        </div>
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
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-wrap gap-2">
            <Meta label="Location" icon={<MapPin size={13} />}>
              {listing.location ?? "Location not specified"}
            </Meta>
            <Meta label="Work mode" icon={<BriefcaseBusiness size={13} />}>
              {workModeLabel(listing.workMode)}
            </Meta>
          </div>
          <StudentCard>
            <h2 className="mb-2 text-[16px] font-bold text-[#0A1931]">
              About the role
            </h2>
            <p className="text-[14px] leading-6 text-[#3A4761]">
              {listing.description || "No description was provided."}
            </p>
          </StudentCard>
          <StudentCard>
            <h2 className="mb-3 text-[16px] font-bold text-[#0A1931]">Skills</h2>
            <div className="flex flex-wrap gap-2">
              {listing.skills.map((skill) => (
                <SkillChip key={skill}>{skill}</SkillChip>
              ))}
            </div>
          </StudentCard>
        </div>

        <div className="flex flex-col gap-3">
          <StudentCard>
            <div className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#7A8496]">Salary range</span>
              <span className="text-[18px] font-bold leading-6 text-[#0A1931]">
              {formatSalary(listing)}
              </span>
            </div>
            <span className="mt-3 block border-t border-[#EEE9F3] pt-3 text-[12px] text-[#5F6B80]">
              <span className="font-semibold text-[#3A4761]">Published</span> · {formatDate(listing.publishedAt)}
            </span>
          </StudentCard>
          {applied ? (
            <PillButton
              variant="secondary"
              className="w-full"
              onClick={() => router.push("/student/board")}
            >
              Applied · see my board
            </PillButton>
          ) : (
            <PillButton
              className="w-full"
              disabled={
                !eligible || applyState.isLoading || applications.isLoading
              }
              onClick={() => void submitApplication()}
            >
              {applications.isLoading
                ? "Checking applications…"
                : applyState.isLoading
                  ? "Applying…"
                  : "Apply now"}
            </PillButton>
          )}
          {applyState.error ? (
            <StudentErrorState
              variant="inline"
              error={applyState.error}
              fallback="Could not submit your application."
            />
          ) : null}
        </div>
      </div>
    </StudentPage>
  );
}

function Meta({
  label,
  icon,
  children,
}: {
  label: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-xl border border-[#E7E0D4] bg-white px-3 py-2 text-[12px] text-[#3A4761]">
      <span className="text-[#778197]">{icon}</span>
      <span><span className="mr-1 font-semibold text-[#68758A]">{label}:</span>{children}</span>
    </span>
  );
}
