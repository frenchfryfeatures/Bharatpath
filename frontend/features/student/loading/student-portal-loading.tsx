import { Skeleton } from "@/components/common/loading";
import {
  CourseDetailSkeleton,
  CourseListSkeleton,
} from "@/features/student/courses/course-skeletons";
import { StudentPage } from "@/features/student/shell/student-page";
import {
  StudentApplicationDetailSkeleton,
  StudentApplicationGridSkeleton,
  StudentJobDetailSkeleton,
  StudentJobGridSkeleton,
  StudentProfileSkeleton,
} from "./student-route-skeletons";

const card = "rounded-[24px] border border-[#E7E0D4] bg-white p-5 sm:p-6";

function Region({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

function TopBar() {
  return (
    <div className="mb-5 flex h-10 items-center gap-3">
      <Skeleton width={40} height={40} circle />
      <Skeleton width={170} height={21} radius={7} />
    </div>
  );
}

function HomeLoading() {
  return (
    <StudentPage>
      <Region label="Loading home">
        <div className="mb-6">
          <Skeleton width={130} height={14} radius={6} />
          <Skeleton className="mt-2" width={185} height={32} radius={8} />
        </div>
        <div className="grid gap-4 xl:grid-cols-3">
          <div className="flex min-h-[230px] flex-col justify-between rounded-[24px] bg-[#5F4DB2] p-5 sm:p-6">
            <Skeleton
              className="opacity-55"
              width={145}
              height={12}
              radius={6}
            />
            <Skeleton
              className="opacity-55"
              width={150}
              height={64}
              radius={10}
            />
            <Skeleton
              className="opacity-55"
              width="100%"
              height={7}
              radius={999}
            />
          </div>
          <div className={card}>
            <div className="flex justify-between gap-3">
              <Skeleton width={115} height={12} radius={6} />
              <Skeleton width={132} height={29} radius={999} />
            </div>
            <div className="mt-16 flex items-center gap-4">
              <Skeleton width={72} height={72} circle />
              <div className="flex-1">
                <Skeleton width="65%" height={43} radius={8} />
                <Skeleton className="mt-2" width="45%" height={12} radius={6} />
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
            {[0, 1].map((index) => (
              <div
                key={index}
                className="rounded-[20px] border border-[#CDC4EA] bg-[#DDD6F2] p-4"
              >
                <Skeleton width={36} height={36} radius={12} />
                <Skeleton className="mt-4" width="56%" height={15} radius={6} />
                <Skeleton className="mt-2" width="70%" height={11} radius={6} />
              </div>
            ))}
          </div>
        </div>
        <Skeleton className="mb-4 mt-9" width={170} height={12} radius={6} />
        <StudentJobGridSkeleton count={3} />
      </Region>
    </StudentPage>
  );
}

function JobsLoading() {
  return (
    <StudentPage>
      <Region label="Loading jobs">
        <div className="flex gap-2">
          <Skeleton className="flex-1" width="100%" height={48} radius={999} />
          <Skeleton width={48} height={48} circle />
        </div>
        <Skeleton className="mt-4" width={250} height={46} radius={16} />
        <Skeleton className="mb-4 mt-7" width={80} height={12} radius={6} />
        <StudentJobGridSkeleton count={6} />
      </Region>
    </StudentPage>
  );
}

function BoardLoading() {
  return (
    <StudentPage>
      <Region label="Loading application board">
        <div className="mb-7 flex gap-2">
          {[65, 80, 82].map((width) => (
            <Skeleton key={width} width={width} height={36} radius={999} />
          ))}
        </div>
        <Skeleton className="mb-4" width={125} height={12} radius={6} />
        <StudentApplicationGridSkeleton count={6} />
      </Region>
    </StudentPage>
  );
}

function InvitesLoading() {
  return (
    <StudentPage>
      <Region label="Loading invitations">
        <Skeleton width="78%" height={15} radius={6} />
        <div className="my-6 flex gap-2 overflow-hidden">
          {[58, 155, 85, 85].map((width, index) => (
            <Skeleton key={index} width={width} height={36} radius={999} />
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div
              key={index}
              className="flex min-h-[196px] flex-col gap-4 rounded-[18px] border border-[#E9E4DA] bg-white p-4"
            >
              <div className="flex items-center gap-3">
                <Skeleton width={40} height={40} radius={12} />
                <div className="flex-1">
                  <Skeleton width="66%" height={15} radius={6} />
                  <Skeleton
                    className="mt-2"
                    width="45%"
                    height={12}
                    radius={6}
                  />
                </div>
                <Skeleton width={82} height={25} radius={999} />
              </div>
              <Skeleton width="70%" height={12} radius={6} />
              <Skeleton width="100%" height={43} radius={12} />
              <Skeleton
                className="mt-auto"
                width={120}
                height={32}
                radius={999}
              />
            </div>
          ))}
        </div>
      </Region>
    </StudentPage>
  );
}

function InterviewLoading() {
  return (
    <StudentPage>
      <Region label="Loading mock interview">
        <div className="overflow-hidden rounded-2xl border border-[#E7E0D4] bg-white">
          <div className="bg-[linear-gradient(115deg,#F7F4EC_0%,#FFFCF7_62%,#F1EAF7_100%)] p-6">
            <Skeleton width={170} height={24} radius={999} />
            <Skeleton className="mt-4" width="55%" height={26} radius={8} />
            <Skeleton className="mt-3" width="72%" height={13} radius={6} />
          </div>
          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:p-7">
            <div>
              <Skeleton width={140} height={16} radius={6} />
              <div className="mt-4 rounded-xl border border-[#E7E0D4] p-5">
                <Skeleton width="62%" height={18} radius={7} />
                <Skeleton className="mt-4" width="90%" height={13} radius={6} />
                <Skeleton className="mt-3" width="77%" height={13} radius={6} />
                <Skeleton
                  className="mt-5"
                  width={140}
                  height={40}
                  radius={999}
                />
              </div>
            </div>
            <div className="rounded-xl border border-[#E7E0D4] p-5">
              <Skeleton width="55%" height={16} radius={6} />
              <Skeleton className="mt-6" width="70%" height={35} radius={8} />
              <Skeleton className="mt-5" width="100%" height={42} radius={10} />
            </div>
          </div>
        </div>
        <div className={`${card} mt-5`}>
          <Skeleton width={145} height={17} radius={7} />
          {[0, 1].map((index) => (
            <div
              key={index}
              className="mt-4 rounded-xl border border-[#E7E0D4] p-4"
            >
              <Skeleton width="45%" height={14} radius={6} />
              <Skeleton className="mt-2" width="27%" height={11} radius={5} />
            </div>
          ))}
        </div>
      </Region>
    </StudentPage>
  );
}

function InterviewSessionLoading() {
  return (
    <StudentPage>
      <Region label="Loading interview session">
        <div className="mx-auto max-w-3xl space-y-4">
          <div className={card}>
            <Skeleton width="36%" height={14} radius={6} />
            <Skeleton className="mt-4" width="100%" height={6} radius={999} />
          </div>
          <div className={card}>
            <Skeleton width="72%" height={25} radius={8} />
            <Skeleton className="mt-4" width="35%" height={24} radius={999} />
            <Skeleton className="mt-7" width="100%" height={90} radius={15} />
          </div>
          <div className={card}>
            <Skeleton width="42%" height={15} radius={6} />
            <Skeleton className="mt-5" width="100%" height={48} radius={12} />
          </div>
        </div>
      </Region>
    </StudentPage>
  );
}

function InterviewFeedbackLoading() {
  return (
    <StudentPage>
      <Region label="Loading interview feedback">
        <TopBar />
        <div className={`${card} min-h-[420px]`}>
          <Skeleton width={54} height={54} circle />
          <Skeleton className="mt-6" width="52%" height={28} radius={8} />
          <Skeleton className="mt-5" width="100%" height={15} radius={7} />
          <Skeleton className="mt-3" width="84%" height={15} radius={7} />
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <Skeleton width="100%" height={104} radius={14} />
            <Skeleton width="100%" height={104} radius={14} />
          </div>
        </div>
      </Region>
    </StudentPage>
  );
}

function SubscriptionLoading() {
  return (
    <StudentPage>
      <Region label="Loading subscription">
        <div className={card}>
          <Skeleton width={150} height={19} radius={7} />
          <div className="mt-5 flex flex-wrap gap-3">
            <Skeleton width={90} height={24} radius={999} />
            <Skeleton width={120} height={24} radius={999} />
            <Skeleton width={130} height={24} radius={999} />
          </div>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className={card}>
              <Skeleton width={100} height={13} radius={6} />
              <Skeleton className="mt-4" width={140} height={36} radius={8} />
              <Skeleton className="mt-3" width={80} height={14} radius={6} />
              <Skeleton className="mt-5" width="100%" height={42} radius={9} />
            </div>
          ))}
        </div>
      </Region>
    </StudentPage>
  );
}

function ScoreLoading() {
  return (
    <StudentPage>
      <Region label="Loading resume score">
        <TopBar />
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col items-center gap-5 rounded-[24px] bg-[#5F4DB2] p-6">
            <Skeleton className="opacity-55" width={190} height={190} circle />
            <Skeleton
              className="opacity-55"
              width={110}
              height={16}
              radius={7}
            />
          </div>
          <div className="flex flex-col gap-4">
            <div className={card}>
              <Skeleton width="58%" height={18} radius={7} />
              <Skeleton className="mt-5" width="100%" height={14} radius={6} />
              <Skeleton className="mt-3" width="80%" height={14} radius={6} />
            </div>
            <Skeleton width={150} height={44} radius={999} />
          </div>
        </div>
      </Region>
    </StudentPage>
  );
}

function ScoreInfoLoading() {
  return (
    <StudentPage>
      <Region label="Loading score information">
        <TopBar />
        <Skeleton width="65%" height={29} radius={8} />
        <div className="mt-5 rounded-[20px] border border-[#E7E0D4] bg-white p-5">
          <Skeleton width="90%" height={15} radius={6} />
          <Skeleton className="mt-3" width="74%" height={15} radius={6} />
        </div>
        <Skeleton className="mt-5" width={160} height={45} radius={999} />
      </Region>
    </StudentPage>
  );
}

function StreakLoading() {
  return (
    <StudentPage>
      <Region label="Loading daily streak">
        <TopBar />
        <div className="grid gap-5 xl:grid-cols-12">
          <div className={`${card} xl:col-span-12`}>
            <div className="flex justify-between gap-3">
              <Skeleton width={112} height={12} radius={6} />
              <Skeleton width={146} height={28} radius={999} />
            </div>
            <div className="mt-7 flex items-center gap-5">
              <Skeleton width={96} height={96} circle />
              <div className="flex-1">
                <Skeleton width="38%" height={56} radius={10} />
                <Skeleton className="mt-3" width="62%" height={13} radius={6} />
              </div>
            </div>
          </div>
          {[7, 5, 7, 5].map((span, index) => (
            <div
              key={index}
              className={`${card} min-h-56 ${span === 7 ? "xl:col-span-7" : "xl:col-span-5"}`}
            >
              <Skeleton width="42%" height={13} radius={6} />
              <Skeleton
                className="mt-6"
                width="100%"
                height={140}
                radius={18}
              />
            </div>
          ))}
        </div>
      </Region>
    </StudentPage>
  );
}

function AttributeLoading() {
  return (
    <StudentPage>
      <Region label="Loading attribute check">
        <TopBar />
        <div className="space-y-4">
          {[0, 1].map((section) => (
            <div key={section} className={card}>
              {[0, 1, 2].map((question) => (
                <div key={question} className="mb-5 last:mb-0">
                  <Skeleton width="65%" height={16} radius={6} />
                  <Skeleton
                    className="mt-3"
                    width="35%"
                    height={40}
                    radius={10}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      </Region>
    </StudentPage>
  );
}

function ResumeLoading() {
  return (
    <StudentPage>
      <Region label="Loading resume">
        <Skeleton width={140} height={38} radius={999} />
        <div className="mt-5 grid items-start gap-6 lg:grid-cols-[minmax(0,720px)_minmax(260px,1fr)] lg:gap-8">
          <div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1].map((index) => (
                <div
                  key={index}
                  className="flex min-h-[104px] items-center gap-4 rounded-[22px] border border-[#E7E0D4] bg-white p-5"
                >
                  <Skeleton width={56} height={56} radius={18} />
                  <div className="flex-1">
                    <Skeleton width="70%" height={16} radius={6} />
                    <Skeleton
                      className="mt-2"
                      width="90%"
                      height={12}
                      radius={6}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className={`${card} mt-5`}>
              <Skeleton width="42%" height={24} radius={8} />
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="mt-5">
                  <Skeleton width={110} height={12} radius={6} />
                  <Skeleton
                    className="mt-2"
                    width="100%"
                    height={42}
                    radius={10}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className={card}>
            <Skeleton width={44} height={44} radius={12} />
            <Skeleton className="mt-4" width="70%" height={18} radius={7} />
            <Skeleton className="mt-3" width="100%" height={13} radius={6} />
          </div>
        </div>
      </Region>
    </StudentPage>
  );
}

function PrivacyLoading() {
  return (
    <StudentPage>
      <Region label="Loading profile visibility">
        <TopBar />
        <div className={card}>
          <Skeleton width="45%" height={30} radius={8} />
          <Skeleton className="mt-3" width="64%" height={14} radius={6} />
        </div>
        <div className="mt-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1.8fr)_minmax(280px,1fr)]">
          <div className={card}>
            <Skeleton width="40%" height={17} radius={7} />
            {[0, 1, 2].map((index) => (
              <div key={index} className="mt-6 flex items-center gap-3">
                <Skeleton width={42} height={42} circle />
                <div className="flex-1">
                  <Skeleton width="55%" height={14} radius={6} />
                  <Skeleton
                    className="mt-2"
                    width="35%"
                    height={11}
                    radius={5}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-4">
            <div className={card}>
              <Skeleton width="90%" height={13} radius={6} />
              <Skeleton className="mt-2" width="70%" height={13} radius={6} />
            </div>
            <div className={card}>
              <Skeleton width="65%" height={17} radius={7} />
              <Skeleton className="mt-3" width="100%" height={13} radius={6} />
            </div>
          </div>
        </div>
      </Region>
    </StudentPage>
  );
}

/** The gate and route fallbacks use the same page-shaped placeholder. */
export function StudentPortalLoading({ pathname }: { pathname: string }) {
  if (pathname === "/student" || pathname === "/student/notifications")
    return <HomeLoading />;
  if (pathname === "/student/jobs") return <JobsLoading />;
  if (pathname.startsWith("/student/jobs/"))
    return <StudentJobDetailSkeleton />;
  if (pathname === "/student/invites") return <InvitesLoading />;
  if (pathname === "/student/board") return <BoardLoading />;
  if (pathname.startsWith("/student/board/"))
    return <StudentApplicationDetailSkeleton />;
  if (pathname === "/student/interview") return <InterviewLoading />;
  if (
    pathname.endsWith("/feedback") &&
    pathname.startsWith("/student/interview/")
  )
    return <InterviewFeedbackLoading />;
  if (pathname.startsWith("/student/interview/"))
    return <InterviewSessionLoading />;
  if (pathname === "/student/courses") return <CourseListSkeleton />;
  if (pathname.startsWith("/student/courses/")) return <CourseDetailSkeleton />;
  if (pathname === "/student/subscription") return <SubscriptionLoading />;
  if (pathname === "/student/profile") return <StudentProfileSkeleton />;
  if (pathname === "/student/profile/resume") return <ResumeLoading />;
  if (pathname === "/student/privacy") return <PrivacyLoading />;
  if (pathname === "/student/score") return <ScoreLoading />;
  if (pathname.startsWith("/student/score/")) return <ScoreInfoLoading />;
  if (pathname === "/student/streak") return <StreakLoading />;
  if (pathname === "/student/attribute") return <AttributeLoading />;
  return <HomeLoading />;
}
