"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChangePasswordModal } from "@/components/auth/change-password-modal";
import { CareerOverview } from "./career-overview";
import { useAppSelector } from "@/store/hooks";
import {
  BookOpen,
  Building2,
  ChevronRight,
  ClipboardCheck,
  Eye,
  FileText,
  KeyRound,
  Languages,
  MapPin,
  Mic2,
  type LucideIcon,
} from "lucide-react";

import {
  useGetStudentApplicationsQuery,
  useGetStudentCoursesQuery,
  useGetStudentProfileQuery,
  useGetStudentProfileViewsQuery,
  useGetStudentScoreQuery,
} from "@/store/student";
import { formatDateTime } from "@/features/student/formatters";
import {
  interactiveCardClass,
  NoteStrip,
  StudentCard,
  StudentErrorState,
} from "@/features/student/components";
import { Skeleton } from "@/components/common/loading";
import { StudentProfileSkeleton } from "@/features/student/loading";
import { StudentPage } from "@/features/student/shell";

export function StudentProfile() {
  const router = useRouter();
  const [passwordOpen, setPasswordOpen] = useState(false);
  const accountEmail = useAppSelector((state) => state.auth.user?.email ?? "");
  const profile = useGetStudentProfileQuery();
  const score = useGetStudentScoreQuery();
  const applications = useGetStudentApplicationsQuery({ limit: 100 });
  const courses = useGetStudentCoursesQuery();
  if (
    profile.isLoading ||
    score.isLoading ||
    applications.isLoading ||
    courses.isLoading
  ) {
    return <StudentProfileSkeleton />;
  }

  return (
    <StudentPage>
      <div className="flex flex-col gap-6">
        <CareerOverview
          fullName={profile.data?.fullName ?? "Student"}
          email={accountEmail}
          summaryStats={
            <div className="grid grid-cols-3 gap-2 sm:max-w-md">
              <StatTile
                value={
                  score.data?.status === "READY" && score.data.value != null
                    ? String(score.data.value)
                    : "-"
                }
                label="Score"
                tone="indigo"
                onClick={() => router.push("/student/score")}
              />
              <StatTile
                value={String(
                  applications.data?.total ??
                    applications.data?.items.length ??
                    0,
                )}
                label="Applications"
                onClick={() => router.push("/student/board")}
              />
              <StatTile
                value={String(courses.data?.length ?? 0)}
                label="Add-ons"
                onClick={() => router.push("/student/courses")}
              />
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <section
              id="profile-reports"
              className="scroll-mt-24 rounded-[20px] border border-[#E7E0D4] bg-white p-4"
            >
              <h2 className="text-[15px] font-semibold leading-5 text-[#0A1931]">
                Reports and learning
              </h2>
              <p className="mt-1 mb-4 text-[13px] leading-5 text-[#5F6B80]">
                Your resume review, assessments, interview feedback and courses
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                <ProfileAction
                  icon={FileText}
                  title="Resume review"
                  detail="Review your document and scoring history"
                  tone="violet"
                  onClick={() => router.push("/student/profile/resume")}
                />
                <ProfileAction
                  icon={ClipboardCheck}
                  title="Attribute report"
                  detail="View your completed assessment"
                  tone="green"
                  onClick={() => router.push("/student/attribute")}
                />
                <ProfileAction
                  icon={Mic2}
                  title="Interview report"
                  detail="Practice history and feedback"
                  tone="orange"
                  onClick={() =>
                    router.push("/student/interview#interview-history")
                  }
                />
                <ProfileAction
                  icon={BookOpen}
                  title="Skill courses"
                  detail={`${courses.data?.length ?? 0} available · ${courses.data?.filter((course) => course.completed).length ?? 0} completed`}
                  tone="blue"
                  onClick={() => router.push("/student/courses")}
                />
                <ProfileAction
                  icon={Languages}
                  title="Language"
                  detail="English"
                  tone="gold"
                />
              </div>
            </section>

            <section
              id="profile-privacy"
              className="scroll-mt-24 flex flex-col gap-3 rounded-[20px] border border-[#E7E0D4] bg-white p-4"
            >
              <h2 className="text-[15px] font-semibold leading-5 text-[#0A1931]">
                Privacy and account
              </h2>
              <button
                type="button"
                onClick={() => router.push("/student/privacy")}
                className={`flex items-center gap-3 rounded-2xl border border-[#E7E0D4] bg-white p-4 text-left ${interactiveCardClass}`}
              >
                <Eye size={20} className="text-[#5F4DB2]" />
                <span className="flex flex-1 flex-col">
                  <span className="text-[15px] font-medium text-[#0A1931]">
                    Who has seen me
                  </span>
                  <span className="text-[12px] text-[#5F6B80]">
                    See which employers opened your profile
                  </span>
                </span>
                <ChevronRight
                  size={17}
                  className="shrink-0 text-[#7B8495]"
                  aria-hidden="true"
                />
              </button>
              <button
                type="button"
                onClick={() => setPasswordOpen(true)}
                className={`flex items-center gap-3 rounded-2xl border border-[#E7E0D4] bg-white p-4 text-left ${interactiveCardClass}`}
              >
                <KeyRound size={20} className="text-[#5F4DB2]" />
                <span className="flex flex-1 flex-col">
                  <span className="text-[15px] font-medium text-[#0A1931]">
                    Change password
                  </span>
                  <span className="text-[12px] text-[#5F6B80]">
                    Update the password you use to sign in
                  </span>
                </span>
                <ChevronRight
                  size={17}
                  className="shrink-0 text-[#7B8495]"
                  aria-hidden="true"
                />
              </button>
              <NoteStrip icon={<MapPin size={16} />}>
                Only your city and state are used for job discovery. Do not
                enter a street address.
              </NoteStrip>
            </section>
          </div>
        </CareerOverview>
      </div>
      <ChangePasswordModal
        open={passwordOpen}
        onClose={() => setPasswordOpen(false)}
        theme="student"
        pool="CANDIDATE"
      />
    </StudentPage>
  );
}

function ProfileAction({
  icon: Icon,
  title,
  detail,
  tone,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  detail: string;
  tone: "violet" | "green" | "orange" | "blue" | "gold" | "slate";
  onClick?: () => void;
}) {
  const toneClass = {
    violet: "bg-[#F1EAF7] text-[#5F4DB2]",
    green: "bg-[#E6F1EA] text-[#1F6B45]",
    orange: "bg-[#FFF0E7] text-[#A65325]",
    blue: "bg-[#E8F0FA] text-[#3566B8]",
    gold: "bg-[#F7EFD6] text-[#85650F]",
    slate: "bg-[#EEF1F5] text-[#475569]",
  }[tone];
  const content = (
    <>
      <span
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${toneClass}`}
      >
        <Icon size={19} aria-hidden="true" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[14px] font-semibold text-[#0A1931]">
          {title}
        </span>
        <span className="line-clamp-2 text-[11px] leading-4 text-[#5F6B80]">
          {detail}
        </span>
      </span>
      {onClick ? (
        <ChevronRight
          size={17}
          className="shrink-0 text-[#7B8495]"
          aria-hidden="true"
        />
      ) : null}
    </>
  );

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={`group flex min-h-20 items-center gap-3 rounded-2xl border border-[#E7E0D4] bg-white p-3.5 text-left ${interactiveCardClass}`}
    >
      {content}
    </button>
  ) : (
    <div className="flex min-h-20 items-center gap-3 rounded-2xl border border-[#E7E0D4] bg-white p-3.5">
      {content}
    </div>
  );
}

/**
 * `GET /candidate/profile/views`: the organisations that opened this profile
 * in the last 90 days, latest first. The organisation only - never the
 * recruiter in it, and never a count of opens, which is what the API itself
 * is limited to.
 */
function ProfileViewsCard() {
  const views = useGetStudentProfileViewsQuery({ limit: 10 });

  return (
    <StudentCard className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Building2 size={20} className="text-[#5F4DB2]" />
        <span className="flex flex-1 flex-col">
          <span className="text-[15px] font-medium text-[#0A1931]">
            Profile views
          </span>
          <span className="text-[12px] text-[#5F6B80]">
            {views.isLoading
              ? "Loading…"
              : views.isError
                ? "Could not load who viewed your profile"
                : "Organisations that opened your profile"}
          </span>
        </span>
      </div>

      {views.isLoading ? (
        <div className="flex flex-col gap-2" aria-label="Loading profile views">
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} width="100%" height={14} radius={6} />
          ))}
        </div>
      ) : views.isError ? (
        <StudentErrorState
          variant="inline"
          error={views.error}
          fallback="We could not load your profile views."
          onRetry={() => void views.refetch()}
        />
      ) : views.data?.items.length ? (
        <>
          <ul className="flex flex-col divide-y divide-[#F0EBDF]">
            {views.data.items.map((view) => (
              <li
                key={`${view.employerName}-${view.lastViewedAt}`}
                className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <span className="min-w-0 truncate text-[13px] font-medium text-[#0A1931]">
                  {view.employerName}
                </span>
                <span className="shrink-0 text-[11px] text-[#5F6B80]">
                  {formatDateTime(view.lastViewedAt)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] leading-4 text-[#5F6B80]">
            Last 90 days, most recent first. Which organisation looked - never
            which person, and never how many times.
          </p>
        </>
      ) : (
        <p className="text-[12px] leading-5 text-[#5F6B80]">
          No organisation has opened your profile in the last 90 days.
        </p>
      )}
    </StudentCard>
  );
}

function StatTile({
  value,
  label,
  tone = "cream",
  onClick,
}: {
  value: string;
  label: string;
  tone?: "cream" | "indigo";
  onClick?: () => void;
}) {
  const indigo = tone === "indigo";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={[
        "flex min-w-0 flex-1 flex-col gap-1 rounded-2xl border p-3 text-left",
        indigo
          ? "border-[#5F4DB2] bg-[#5F4DB2] text-white"
          : "border-[#E7E0D4] bg-white text-[#0A1931]",
        onClick
          ? indigo
            ? `${interactiveCardClass} hover:border-[#4A3E8F] hover:bg-[#5646A6]`
            : interactiveCardClass
          : "cursor-default",
      ].join(" ")}
    >
      <span className="text-[22px] font-extrabold leading-6">{value}</span>
      <span
        className={
          indigo ? "text-[12px] text-[#E0DBF4]" : "text-[12px] text-[#5F6B80]"
        }
      >
        {label}
      </span>
    </button>
  );
}
