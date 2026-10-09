"use client";

import { useRouter } from "next/navigation";
import { BookOpen, ChevronRight, Mic2, TrendingDown, TrendingUp } from "lucide-react";

import {
  useGetInterviewOfferQuery,
  useGetStudentCoursesQuery,
  useGetStudentProfileQuery,
  useGetStudentScoreQuery,
  useGetStudentScoreScaleQuery,
} from "@/store/student";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { Skeleton } from "@/components/common/loading";
import { bandLabel, firstName } from "@/features/student/formatters";
import { CommerceBadge, ScoreBandBar, ScoreScaleUnavailable } from "@/features/student/components";
import { MatchingProfileJobs, SimilarToAppliedJobs } from "@/features/student/jobs/recommended-jobs";
import { StudentPage } from "@/features/student/shell";
import { StudentStreakCard } from "@/features/student/streak";
import { useAppSelector } from "@/store/hooks";
import { useScoreChange } from "./use-score-change";

export function StudentHome() {
  const router = useRouter();
  const profile = useGetStudentProfileQuery();
  const score = useGetStudentScoreQuery();
  const userId = useAppSelector((state) => state.auth.user?.id);
  const scoreChange = useScoreChange(userId, score.data);
  const scale = useGetStudentScoreScaleQuery();
  const interview = useGetInterviewOfferQuery();
  const courses = useGetStudentCoursesQuery();

  const interviewPrice =
    !interview.data?.onSale || interview.data.priceMinor == null
      ? "₹349"
      : new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: interview.data.currency || "INR",
          maximumFractionDigits: 0,
        }).format(interview.data.priceMinor / 100);

  const interviewSubtitle = interview.data?.openSessionId
    ? "Continue your session"
    : (interview.data?.sessionsAvailable ?? 0) > 0
      ? `${interview.data?.sessionsAvailable} sessions available`
      : "1-on-1 AI practice";

  const firstCourse = courses.data?.[0];
  const coursesPrice =
    firstCourse?.priceMinor != null
      ? new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: firstCourse.currency || "INR",
          maximumFractionDigits: 0,
        }).format(firstCourse.priceMinor / 100)
      : "₹499";

  const purchasedCourses =
    courses.data?.filter((c) => c.purchased || c.completed).length ?? 0;
  const coursesSubtitle =
    purchasedCourses > 0
      ? `${purchasedCourses} enrolled`
      : (courses.data?.length ?? 0) > 0
        ? `${courses.data?.length} available`
        : "Improve your score";

  return (
    <StudentPage>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-0.5">
          <span className="text-[13px] leading-4 text-[#5F6B80]">
            {new Intl.DateTimeFormat("en-IN", {
              weekday: "long",
              day: "numeric",
              month: "short",
            }).format(new Date())}
          </span>
          {profile.isLoading ? (
            <Skeleton className="mt-1" width={190} height={30} radius={8} />
          ) : (
            <span className="text-[26px] font-bold leading-8 tracking-[-0.025em] text-[#0A1931] sm:text-[30px]">
              Hi, {firstName(profile.data?.fullName)}
            </span>
          )}
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          {score.isLoading ? (
            <ScoreCardSkeleton />
          ) : (
            <button
              type="button"
              onClick={() => router.push("/student/score")}
              className="relative flex h-full min-h-48 flex-col justify-between gap-4 overflow-hidden rounded-[24px] bg-[#5F4DB2] p-5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:bg-[#5646A6] hover:shadow-[0_14px_30px_rgba(95,77,178,0.28)] active:translate-y-0 active:scale-[.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/40 focus-visible:ring-offset-2 sm:p-6"
            >
              <span className="flex items-center justify-between gap-3">
                <span className="text-[11px] font-bold uppercase leading-3 tracking-[0.14em] text-[#E0DBF4]">
                  Your resume score
                </span>
                <span className="flex items-center gap-2">
                  {score.data?.status === "READY" && score.data.band ? (
                    <span className="rounded-full bg-[#F4D685] px-3 py-1 text-[12px] font-bold text-[#0A1931]">
                      {bandLabel(score.data.band)}
                    </span>
                  ) : null}
                  <ChevronRight size={16} className="text-white" />
                </span>
              </span>
              {score.data?.status === "READY" && score.data.value != null ? (
                <>
                  <span className="flex flex-wrap items-baseline gap-x-2 gap-y-2">
                    <span className="text-[46px] font-extrabold leading-none tracking-[-0.045em] text-white sm:text-[64px]">
                      {score.data.value}
                    </span>
                    <span className="text-[14px] font-semibold text-[#E0DBF4] sm:text-[18px]">
                      / 1000
                    </span>
                    {scoreChange != null ? (
                      <span
                        aria-label={`Score ${scoreChange > 0 ? "increased" : "decreased"} by ${Math.abs(scoreChange)} points since last seen on this device`}
                        className="inline-flex items-center gap-1 self-center rounded-full bg-white/20 px-2 py-1 text-[12px] font-bold leading-none text-white sm:text-[14px]"
                      >
                        {scoreChange > 0 ? (
                          <TrendingUp size={14} aria-hidden="true" />
                        ) : (
                          <TrendingDown size={14} aria-hidden="true" />
                        )}
                        {scoreChange > 0 ? "+" : "−"}{Math.abs(scoreChange)}
                      </span>
                    ) : null}
                  </span>
                  {scale.isLoading ? (
                    <span
                      aria-hidden="true"
                      className="bp-skeleton block h-[6px] w-full rounded-full opacity-55"
                    />
                  ) : scale.data ? (
                    <ScoreBandBar
                      scale={scale.data}
                      band={score.data.band}
                      value={score.data.value}
                    />
                  ) : scale.error ? (
                    <ScoreScaleUnavailable
                      message={getApiErrorMessage(
                        scale.error,
                        "Open your score to try again.",
                      )}
                    />
                  ) : null}
                </>
              ) : (
                <span className="text-[18px] font-semibold text-white">
                  Your score is being prepared
                </span>
              )}
            </button>
          )}
          <StudentStreakCard />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-1 xl:grid-rows-2 h-full">
            {interview.isLoading ? (
              <AddOnCardSkeleton label="Loading mock interview" />
            ) : (
              <AddOnButton
                title="Mock interview"
                subtitle={interviewSubtitle}
                badge={interviewPrice}
                icon={<Mic2 size={16} />}
                onClick={() => router.push("/student/interview")}
              />
            )}
            {courses.isLoading ? (
              <AddOnCardSkeleton label="Loading skill courses" />
            ) : (
              <AddOnButton
                title="Skill courses"
                subtitle={coursesSubtitle}
                badge={coursesPrice}
                icon={<BookOpen size={16} />}
                onClick={() => router.push("/student/courses")}
              />
            )}
          </div>
        </div>

        <SimilarToAppliedJobs />
        <MatchingProfileJobs />
      </div>
    </StudentPage>
  );
}

function ScoreCardSkeleton() {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex h-full min-h-48 flex-col justify-between gap-4 rounded-[24px] bg-[#5F4DB2] p-5 sm:p-6"
    >
      <span className="sr-only">Loading score</span>
      <div className="flex items-center justify-between">
        <Skeleton className="opacity-55" width={138} height={11} radius={5} />
        <Skeleton className="opacity-55" width={16} height={16} radius={5} />
      </div>
      <div>
        <Skeleton className="opacity-55" width={124} height={58} radius={10} />
        <Skeleton
          className="mt-3 opacity-55"
          width={96}
          height={12}
          radius={6}
        />
      </div>
    </div>
  );
}

function AddOnCardSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex h-full min-h-[96px] flex-col justify-between gap-3 rounded-[20px] border border-[#CDC4EA] bg-[#DDD6F2] p-4"
    >
      <span className="sr-only">{label}</span>
      <div className="flex items-start justify-between">
        <Skeleton className="opacity-55" width={36} height={36} radius={12} />
        <Skeleton className="opacity-55" width={76} height={28} radius={999} />
      </div>
      <div>
        <Skeleton className="opacity-55" width="48%" height={15} radius={6} />
        <Skeleton
          className="mt-2 opacity-55"
          width="68%"
          height={11}
          radius={6}
        />
      </div>
    </div>
  );
}

function AddOnButton({
  title,
  subtitle,
  badge,
  icon,
  onClick,
}: {
  title: string;
  subtitle: string;
  badge: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full flex-col justify-between gap-3 overflow-hidden rounded-[20px] border border-[#CDC4EA] bg-[#DDD6F2] p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[#B7AAE0] hover:bg-[#D4CBEE] hover:shadow-[0_10px_24px_rgba(74,62,143,0.14)] active:translate-y-0 active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30"
    >
      <span className="flex items-start justify-between">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/70 text-[#4A3E8F]">
          {icon}
        </span>
        <CommerceBadge>{badge}</CommerceBadge>
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[15px] font-bold leading-5 tracking-[-0.02em] text-[#0A1931]">
          {title}
        </span>
        <span className="text-[12px] leading-4 text-[#3A4761]">{subtitle}</span>
      </span>
    </button>
  );
}
