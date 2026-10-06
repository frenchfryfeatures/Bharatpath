"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, BookOpen, BriefcaseBusiness, FileText, Mic2, TrendingUp } from "lucide-react";

import { Skeleton } from "@/components/common/loading";
import { usePageHeader } from "@/components/layout/header-context";
import { CollegeErrorState } from "@/features/college/components/college-error-state";
import { CollegeStudentPageSkeleton } from "@/features/college/students/college-student-page-skeleton";
import {
  useGetCollegeStudentQuery,
  useGetCollegeStudentDetailsQuery,
  useGetCollegeStudentResumeQuery,
} from "@/store/college/students/students.api";

const panel = "min-w-0 rounded-xl border border-[#e7e9ee] bg-white p-5";

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function humanise(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return <div className="min-w-0"><dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-[#8992a1]">{label}</dt><dd className="mt-1 break-words text-[13px] font-semibold text-[#172033]">{value === null || value === undefined || value === "" ? "Not provided" : value}</dd></div>;
}

function Section({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return <section className={panel}><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-[14px] font-bold text-[#172033]">{title}</h2>{detail && <span className="text-[11px] text-[#7b8494]">{detail}</span>}</div>{children}</section>;
}

function SectionSkeleton() {
  return <div className={panel}><Skeleton width={110} height={15} /><div className="mt-5 grid gap-4 sm:grid-cols-2">{Array.from({ length: 4 }).map((_, index) => <div key={index} className="space-y-2"><Skeleton width={75} height={10} /><Skeleton width="74%" height={15} /></div>)}</div></div>;
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-[#dfe4ec] bg-[#fbfcfe] px-4 py-5 text-[12px] text-[#7b8494]">{children}</p>;
}

function ResumeFields({ fields }: { fields: Record<string, unknown> }) {
  const entries = Object.entries(fields);
  if (!entries.length) return null;
  return <dl className="grid gap-4 sm:grid-cols-2">{entries.map(([key, value]) => <Field key={key} label={humanise(key)} value={Array.isArray(value) ? value.join(", ") : typeof value === "object" && value !== null ? Object.entries(value).map(([name, item]) => `${humanise(name)}: ${String(item)}`).join(" · ") : String(value ?? "")} />)}</dl>;
}

export default function CollegeStudentPage() {
  const id = useParams<{ candidateId: string }>().candidateId;
  const student = useGetCollegeStudentQuery(id);
  const details = useGetCollegeStudentDetailsQuery(id);
  const resume = useGetCollegeStudentResumeQuery(id, { skip: !details.data?.has_resume_file });

  usePageHeader("Students", "Roster, invites, bulk upload and consent...");

  if (student.isLoading) return <CollegeStudentPageSkeleton />;
  if (student.error || !student.data) return <div className="mx-auto max-w-7xl"><Link href="/college/students" className="mb-4 inline-flex items-center gap-1 text-[12px] font-semibold text-[#315c9f]"><ArrowLeft size={14} /> Students</Link><CollegeErrorState error={student.error} fallback="This student is unavailable or has withdrawn visibility." /></div>;

  const profile = student.data;
  const initials = (profile.fullName ?? "Student").split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const shared = Boolean(details.data);
  const summary = [
    { label: "Current score", value: profile.score ?? "-", detail: profile.band ? humanise(profile.band) : "Not scored", icon: TrendingUp },
    { label: "Practice interviews", value: details.data?.interviews_completed ?? (details.isLoading ? "…" : "-"), detail: shared ? "Completed on BharatPath" : "Requires individual consent", icon: Mic2 },
    { label: "Courses", value: details.data?.courses.length ?? (details.isLoading ? "…" : "-"), detail: shared ? "Purchased" : "Requires individual consent", icon: BookOpen },
    { label: "Applications", value: details.data?.analytics.total ?? profile.applications, detail: shared ? `${details.data?.analytics.open ?? 0} open` : "On BharatPath", icon: BriefcaseBusiness },
  ];

  return <div className="mx-auto max-w-7xl space-y-5 pb-6 text-[#172033]">
    <div><Link href="/college/students" className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#315c9f] hover:underline"><ArrowLeft size={14} /> Students</Link></div>
    <header className="flex flex-wrap items-center gap-3"><div className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#eaf0f9] text-[16px] font-bold text-[#315c9f]">{initials}</div><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h1 className="text-[21px] font-bold tracking-tight">{profile.fullName ?? "Student"}</h1><span className="rounded-full bg-[#eaf5ef] px-2.5 py-1 text-[10px] font-bold text-[#23805d]">Individually visible</span></div><p className="text-[12px] text-[#7b8494]">Visible since {formatDate(profile.visibleSince)}</p></div></header>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{summary.map(({ label, value, detail, icon: Icon }) => <div key={label} className={panel}><div className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold text-[#7b8494]">{label}</span><Icon size={16} className="text-[#315c9f]" /></div><p className="mt-3 text-[25px] font-bold leading-none">{value}</p><p className="mt-1 text-[11px] text-[#7b8494]">{detail}</p></div>)}</div>

    <div className="grid items-start gap-5 xl:grid-cols-2">
      {details.isLoading ? <SectionSkeleton /> : <Section title="Onboarding details" detail={details.data?.questionnaire.length ? `${details.data.questionnaire.length} answers` : undefined}>
        {details.error ? <Notice>The student has not shared additional profile details with your college under the current consent.</Notice> : details.data && <><dl className="grid gap-4 sm:grid-cols-2"><Field label="Full name" value={profile.fullName} /><Field label="Email" value={details.data.email} /><Field label="Phone" value={details.data.phone} /><Field label="Location" value={[details.data.city, details.data.state_code].filter(Boolean).join(", ")} /><Field label="Language" value={details.data.locale} /></dl><div className="mt-5 border-t border-[#edf0f3] pt-4"><h3 className="mb-3 text-[12px] font-bold">Onboarding answers</h3>{details.data.questionnaire.length ? <dl className="space-y-3">{details.data.questionnaire.map((answer) => <div key={answer.code}><dt className="text-[11px] text-[#7b8494]">{answer.question}</dt><dd className="mt-0.5 text-[12px] font-medium">{answer.answer}</dd></div>)}</dl> : <Notice>No questionnaire answers submitted.</Notice>}</div></>}
      </Section>}

      {details.isLoading || (details.data?.has_resume_file && resume.isLoading) ? <SectionSkeleton /> : <Section title="Resume" detail={resume.data?.confirmed_at ? `Confirmed ${formatDate(resume.data.confirmed_at)}` : undefined}>
        {details.error ? <Notice>The student has not shared resume access with your college under the current consent.</Notice> : resume.error ? <Notice>The resume could not be opened right now.</Notice> : resume.data ? <div className="space-y-4"><span className="rounded-full bg-[#eef3fb] px-2.5 py-1 text-[10px] font-bold text-[#315c9f]">{humanise(resume.data.source)}</span>{resume.data.text && <div className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg bg-[#f8f9fb] p-4 text-[12px] leading-5 text-[#344054]">{resume.data.text}</div>}<ResumeFields fields={resume.data.fields} />{resume.data.file_url && <a href={resume.data.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 rounded-lg border border-[#d5dfee] px-3 py-2 text-[12px] font-semibold text-[#315c9f] hover:bg-[#f4f7fc]"><FileText size={15} /> Open uploaded resume</a>}</div> : <Notice>No confirmed resume is available.</Notice>}
      </Section>}

      <Section title="Score and outcomes" detail={profile.scoredAt ? `Scored ${formatDate(profile.scoredAt)}` : undefined}><div className="grid gap-4 sm:grid-cols-2"><Field label="Current score" value={profile.score ?? "Not scored"} /><Field label="Score band" value={profile.band ? humanise(profile.band) : "Not scored"} /><Field label="Applications" value={profile.applications} /><Field label="Employer interviews reached" value={profile.interviews} /></div></Section>

      {details.isLoading ? <SectionSkeleton /> : <Section title="Practice interviews"><div className="flex items-center gap-3 rounded-lg bg-[#f8f9fb] p-4"><span className="grid h-9 w-9 place-items-center rounded-lg bg-[#eef3fb] text-[#315c9f]"><Mic2 size={17} /></span><div><p className="text-[18px] font-bold leading-none">{shared ? details.data?.interviews_completed : "-"}</p><p className="mt-1 text-[11px] text-[#7b8494]">Completed on BharatPath</p></div></div>{!shared && <p className="mt-3 text-[11px] text-[#7b8494]">The student has not shared this information with your college.</p>}</Section>}
    </div>

    {details.isLoading ? <SectionSkeleton /> : <Section title="Courses" detail={details.data?.courses.length ? `${details.data.courses.length} purchased` : undefined}>
      {details.error ? <Notice>Course progress is not shared under the student&apos;s current consent.</Notice> : details.data?.courses.length ? <div className="grid gap-3 lg:grid-cols-2">{details.data.courses.map((course) => <div key={course.code} className="rounded-lg border border-[#e7e9ee] p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-[13px] font-semibold">{course.title}</h3><p className="mt-1 text-[11px] text-[#7b8494]">{course.lessons_completed} of {course.lessons_total} lessons complete</p></div><span className="text-[12px] font-bold text-[#315c9f]">{course.percent_complete}%</span></div><div className="mt-3 h-1.5 rounded-full bg-[#e9edf3]"><div className="h-full rounded-full bg-[#315c9f]" style={{ width: `${Math.min(100, Math.max(0, course.percent_complete))}%` }} /></div></div>)}</div> : <Notice>No purchased courses yet.</Notice>}
    </Section>}

    {details.isLoading ? <SectionSkeleton /> : <Section title="Job applications" detail={details.data ? `${details.data.analytics.total} total · ${details.data.analytics.open} open` : undefined}>
      {details.error ? <Notice>Application stages and analytics are not shared under the student&apos;s current consent. The student has {profile.applications} applications on BharatPath.</Notice> : details.data && <><div className="flex flex-wrap gap-2">{Object.entries(details.data.analytics.by_stage).map(([stage, count]) => <span key={stage} className="rounded-full bg-[#eef3fb] px-2.5 py-1 text-[11px] font-semibold text-[#315c9f]">{humanise(stage)} · {count}</span>)}</div><div className="mt-3 flex flex-wrap gap-3 text-[11px] text-[#7b8494]">{Object.entries(details.data.analytics.reached).map(([stage, count]) => <span key={stage}>Reached {humanise(stage)}: <b className="text-[#172033]">{count}</b></span>)}</div>{details.data.applications.length ? <div className="mt-4 overflow-x-auto rounded-lg border border-[#e7e9ee]"><table className="w-full min-w-[620px] text-left text-[12px]"><thead className="bg-[#f8f9fb] text-[11px] text-[#7b8494]"><tr><th className="px-4 py-3 font-semibold">Job</th><th className="px-4 py-3 font-semibold">Employer</th><th className="px-4 py-3 font-semibold">Stage</th><th className="px-4 py-3 font-semibold">Applied</th></tr></thead><tbody>{details.data.applications.map((item, index) => <tr key={`${item.job_title}-${index}`} className="border-t border-[#edf0f3]"><td className="px-4 py-3 font-semibold">{item.job_title}</td><td className="px-4 py-3 text-[#687182]">{item.employer_name}</td><td className="px-4 py-3"><span className="rounded-full bg-[#f0f2f5] px-2 py-1 text-[10px] font-semibold">{humanise(item.stage)}</span></td><td className="px-4 py-3 text-[#687182]">{formatDate(item.applied_at)}</td></tr>)}</tbody></table></div> : <div className="mt-4"><Notice>No jobs applied to yet.</Notice></div>}</>}
    </Section>}
  </div>;
}
