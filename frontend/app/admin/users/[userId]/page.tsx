"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BriefcaseBusiness, BookOpen, FileText, Mic2, TrendingUp } from "lucide-react";

import { Skeleton } from "@/components/common/loading";
import { StructuredResumeUnavailable, StructuredResumeView, type StructuredResume } from "@/components/resume/structured-resume";
import { usePageHeader } from "@/components/layout/header-context";
import { ErrorState } from "@/components/ui";
import { CandidatePageSkeleton } from "@/features/admin/users/components/candidate-page-skeleton";
import { CandidateOnboardingDetails } from "@/features/admin/users/components/candidate-onboarding-details";
import { PracticeInterviews } from "@/features/admin/users/components/practice-interviews";
import {
  useGetAdminCandidateQuery,
  useGetAdminCandidateOnboardingQuery,
  useGetAdminCandidateResumeQuery,
  useGetAdminCandidateScoreTimelineQuery,
  useGetAdminCandidateInterviewsQuery,
  useGetAdminCandidateCoursesQuery,
  useGetAdminCandidateApplicationsQuery,
  type ResumeVersion,
} from "@/store/api/admin-api";

const panel = "min-w-0 rounded-xl border border-[#e7e9ee] bg-white p-5";
const muted = "text-[12px] text-[#7b8494]";

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function humanise(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Section({ title, detail, headerAction, children, className = "", scrollable = false }: { title: string; detail?: string; headerAction?: React.ReactNode; children: React.ReactNode; className?: string; scrollable?: boolean }) {
  return <section className={`${panel} ${className}`}>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-[14px] font-bold text-[#172033]">{title}</h2><div className="flex flex-wrap items-center gap-3">{detail && <span className={muted}>{detail}</span>}{headerAction}</div></div>
    {scrollable ? (
      <div className="max-h-[560px] overflow-y-auto overscroll-contain pr-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#315c9f]" role="region" aria-label={`${title} content`} tabIndex={0}>{children}</div>
    ) : children}
  </section>;
}

function SectionSkeleton() {
  return <div className={panel}><Skeleton width={110} height={15} /><div className="mt-5 grid gap-4 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="space-y-2"><Skeleton width={76} height={10} /><Skeleton width="70%" height={15} /></div>)}</div></div>;
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-[#e1e5eb] bg-[#fbfcfd] px-4 py-5 text-[12px] text-[#7b8494]">{children}</p>;
}

function UploadedResumeLink({ url }: { url: string }) {
  return <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-[#d5dfee] px-3 py-2 text-[12px] font-semibold text-[#315c9f] hover:bg-[#f4f7fc]"><FileText size={15} /> Open uploaded resume</a>;
}

function ResumeContent({ version, showFileLink = true }: { version: ResumeVersion; showFileLink?: boolean }) {
  const stored = version.fields?.structured_resume;
  const storedResume =
    stored && typeof stored === "object" && "status" in stored && stored.status === "READY" &&
    "data" in stored && stored.data && typeof stored.data === "object"
      ? stored.data as StructuredResume
      : null;
  const structured = version.structured_status === "READY" ? version.structured_resume : storedResume;
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#eef3fb] px-2.5 py-1 text-[10px] font-bold text-[#315c9f]">{humanise(version.source)}</span><span className={muted}>{version.confirmed_at ? `Confirmed ${formatDate(version.confirmed_at)}` : `Added ${formatDate(version.created_at)}`}</span></div>
    {structured ? <StructuredResumeView resume={structured} /> : <StructuredResumeUnavailable status={version.structured_status} />}
    {showFileLink && version.file_url && <UploadedResumeLink url={version.file_url} />}
  </div>;
}

export default function AdminCandidatePage() {
  const id = useParams<{ userId: string }>().userId;
  const summary = useGetAdminCandidateQuery(id);
  const onboarding = useGetAdminCandidateOnboardingQuery(id);
  const resume = useGetAdminCandidateResumeQuery(id);
  const scores = useGetAdminCandidateScoreTimelineQuery(id);
  const interviews = useGetAdminCandidateInterviewsQuery(id);
  const courses = useGetAdminCandidateCoursesQuery(id);
  const applications = useGetAdminCandidateApplicationsQuery(id);

  usePageHeader("Users", "Candidates, employers and institutions on the platform");

  if (summary.isLoading) return <CandidatePageSkeleton />;
  if (summary.error || !summary.data) return <div className="pt-2"><Link href="/admin/users?segment=candidates" className="mb-4 inline-flex items-center gap-1 text-[12px] font-semibold text-[#315c9f]"><ArrowLeft size={14} /> Candidates</Link><ErrorState error={summary.error} fallback="Student details could not be loaded." /></div>;

  const student = summary.data;
  const initials = (student.full_name ?? "Student").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const latestResume = resume.data?.latest;
  const confirmedResume = resume.data?.confirmed;

  return <div className="min-w-0 space-y-5 pb-6 text-[#172033]">
    <div className="pt-2"><Link href="/admin/users?segment=candidates" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#315c9f] hover:underline"><ArrowLeft size={14} /> Candidates</Link></div>

    <header className="flex flex-wrap items-center gap-3">
      <div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#eaf0f9] text-[16px] font-bold text-[#315c9f]">{initials}</div>
      <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h1 className="text-[21px] font-bold tracking-tight">{student.full_name ?? "Student"}</h1><span className="rounded-full bg-[#eef3fb] px-2.5 py-1 text-[10px] font-bold text-[#315c9f]">{humanise(student.status)}</span></div><p className={muted}>Joined {formatDate(student.created_at)} · {student.city ?? "Location not provided"}{student.state_code ? `, ${student.state_code}` : ""}</p></div>
    </header>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {[
        { label: "Current score", value: student.score?.display_value ?? "-", detail: student.score?.band ?? "Not scored", icon: TrendingUp },
        { label: "Practice interviews", value: interviews.data?.length ?? (interviews.isLoading ? "…" : "-"), detail: "Sessions", icon: Mic2 },
        { label: "Courses", value: courses.data?.filter((course) => course.purchased).length ?? (courses.isLoading ? "…" : "-"), detail: "Purchased", icon: BookOpen },
        { label: "Applications", value: applications.data?.analytics.total ?? (applications.isLoading ? "…" : "-"), detail: `${applications.data?.analytics.open ?? 0} open`, icon: BriefcaseBusiness },
      ].map(({ label, value, detail, icon: Icon }) => <div key={label} className={panel}><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold text-[#7b8494]">{label}</span><Icon size={16} className="text-[#315c9f]" /></div><p className="mt-3 text-[25px] font-bold leading-none">{value}</p><p className="mt-1 text-[11px] text-[#7b8494]">{detail}</p></div>)}
    </div>

    <div className="flex flex-col gap-5 xl:flex-row xl:items-stretch">
      <div className="flex min-w-0 flex-col gap-5 xl:flex-1">
        {onboarding.isLoading ? <SectionSkeleton /> : <Section title="Onboarding details" detail={onboarding.data?.questionnaire.length ? `${onboarding.data.questionnaire.length} answers` : undefined} scrollable>
          {onboarding.error ? <Empty>Onboarding details are unavailable for this account.</Empty> : onboarding.data && <>
            <CandidateOnboardingDetails onboarding={onboarding.data} />
            <div className="mt-5 border-t border-[#edf0f3] pt-4"><h3 className="mb-3 text-[12px] font-bold">Onboarding answers</h3>{onboarding.data.questionnaire.length ? <dl className="space-y-3">{onboarding.data.questionnaire.map((answer) => <div key={answer.code}><dt className="text-[11px] text-[#7b8494]">{answer.question}</dt><dd className="mt-0.5 text-[12px] font-medium text-[#172033]">{answer.answer}</dd></div>)}</dl> : <Empty>No questionnaire answers submitted.</Empty>}</div>
            {onboarding.data.college_links.length > 0 && <div className="mt-5 border-t border-[#edf0f3] pt-4"><h3 className="mb-3 text-[12px] font-bold">College links</h3><div className="space-y-2">{onboarding.data.college_links.map((link) => <div key={link.tenant_id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[#f8f9fb] px-3 py-2 text-[12px]"><span className="font-semibold">{link.college}</span><span className="text-[#7b8494]">{humanise(link.scope)} · {formatDate(link.granted_at)}</span></div>)}</div></div>}
          </>}
        </Section>}

        {scores.isLoading ? <SectionSkeleton /> : <Section title="Score timeline" detail={scores.data?.points.length ? `${scores.data.points.length} changes` : undefined} className="xl:flex-1">
          {scores.error ? <Empty>Score timeline is unavailable.</Empty> : scores.data?.points.length ? <ol className="space-y-0">{scores.data.points.map((point, index) => <li key={`${point.computed_at}-${index}`} className="relative border-l-2 border-[#dce5f2] pb-5 pl-5 last:pb-0"><span className="absolute -left-[6px] top-1 h-2.5 w-2.5 rounded-full bg-[#315c9f]" /><div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[13px] font-bold">{point.display_value} <span className="font-medium text-[#687182]">· {humanise(point.band)}</span></span><span className={muted}>{formatDateTime(point.computed_at)}</span></div><p className="mt-1 text-[11px] text-[#7b8494]">{humanise(point.cause)}{point.change === null ? "" : ` · ${point.change > 0 ? "+" : ""}${point.change} points`}</p></li>)}</ol> : <Empty>No score history yet.</Empty>}
        </Section>}
      </div>

      <div className="flex min-w-0 flex-col gap-5 xl:flex-1">
        {resume.isLoading ? (
          <SectionSkeleton />
        ) : (
          <Section title="Resume" detail={latestResume ? "Latest version" : undefined} headerAction={latestResume?.file_url ? <UploadedResumeLink url={latestResume.file_url} /> : undefined} scrollable>
            {resume.error ? (
              <Empty>Resume details are unavailable.</Empty>
            ) : latestResume ? (
              <div className="space-y-5">
                <ResumeContent version={latestResume} showFileLink={false} />
                {confirmedResume && confirmedResume.id !== latestResume.id ? (
                  <div className="border-t border-[#edf0f3] pt-4">
                    <h3 className="mb-3 text-[12px] font-bold">Scored from this version</h3>
                    <ResumeContent version={confirmedResume} />
                  </div>
                ) : null}
              </div>
            ) : (
              <Empty>No resume has been added yet.</Empty>
            )}
          </Section>
        )}

        {interviews.isLoading ? <SectionSkeleton /> : <Section title="Practice interviews" detail={interviews.data?.length ? `${interviews.data.length} sessions` : undefined} className="xl:flex-1">
          {interviews.error ? <Empty>Interviews are unavailable.</Empty> : <PracticeInterviews candidateId={id} sessions={interviews.data ?? []} />}
        </Section>}
      </div>
    </div>

    {courses.isLoading ? <SectionSkeleton /> : <Section title="Courses" detail={courses.data?.length ? `${courses.data.length} available` : undefined}>
      {courses.error ? <Empty>Course status is unavailable.</Empty> : courses.data?.length ? <div className="grid gap-3 lg:grid-cols-2">{courses.data.map((course) => <div key={course.code} className="rounded-lg border border-[#e7e9ee] p-4"><div className="flex items-start justify-between gap-2"><div><h3 className="text-[13px] font-semibold">{course.title}</h3><p className="mt-1 text-[11px] text-[#7b8494]">{course.purchased ? `${course.lessons_completed} of ${course.lessons_total} lessons complete` : "Not purchased"}</p></div><span className="text-[12px] font-bold text-[#315c9f]">{course.purchased ? `${course.percent_complete}%` : "-"}</span></div><div className="mt-3 h-1.5 rounded-full bg-[#e9edf3]"><div className="h-full rounded-full bg-[#315c9f]" style={{ width: `${course.purchased ? Math.min(100, Math.max(0, course.percent_complete)) : 0}%` }} /></div></div>)}</div> : <Empty>No courses available.</Empty>}
    </Section>}

    {applications.isLoading ? <SectionSkeleton /> : <Section title="Job applications" detail={applications.data ? `${applications.data.analytics.total} total · ${applications.data.analytics.open} open` : undefined}>
      {applications.error ? <Empty>Applications are unavailable.</Empty> : applications.data && <><div className="flex flex-wrap gap-2">{Object.entries(applications.data.analytics.by_stage).map(([stage, count]) => <span key={stage} className="rounded-full bg-[#eef3fb] px-2.5 py-1 text-[11px] font-semibold text-[#315c9f]">{humanise(stage)} · {count}</span>)}</div><div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[#7b8494]">{Object.entries(applications.data.analytics.reached).map(([stage, count]) => <span key={stage}>Reached {humanise(stage)}: <b className="text-[#172033]">{count}</b></span>)}</div>{applications.data.items.length ? <div className="mt-4 overflow-x-auto rounded-lg border border-[#e7e9ee]"><table className="w-full min-w-[620px] text-left text-[12px]"><thead className="bg-[#f8f9fb] text-[11px] text-[#7b8494]"><tr><th className="px-4 py-3 font-semibold">Job</th><th className="px-4 py-3 font-semibold">Employer</th><th className="px-4 py-3 font-semibold">Stage</th><th className="px-4 py-3 font-semibold">Applied</th></tr></thead><tbody>{applications.data.items.map((item) => <tr key={item.id} className="border-t border-[#edf0f3]"><td className="px-4 py-3 font-semibold">{item.job_title}</td><td className="px-4 py-3 text-[#687182]">{item.employer_name ?? "-"}</td><td className="px-4 py-3"><span className="rounded-full bg-[#f0f2f5] px-2 py-1 text-[10px] font-semibold">{humanise(item.stage)}</span></td><td className="px-4 py-3 text-[#687182]">{formatDate(item.applied_at)}</td></tr>)}</tbody></table></div> : <div className="mt-4"><Empty>No jobs applied to yet.</Empty></div>}</>}
    </Section>}
  </div>;
}
