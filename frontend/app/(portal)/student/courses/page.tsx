"use client";

import Link from "next/link";
import { BookOpen, ChevronRight, CircleCheck, Clock3, LockKeyhole, RefreshCw, Sparkles } from "lucide-react";

import { useGetStudentCoursesQuery } from "@/store/student";
import { EmptyState, MeterBar, StudentErrorState, StatusChip, interactiveCardClass } from "@/features/student/components";
import { CourseListSkeleton } from "@/features/student/courses/course-skeletons";
import { StudentPage } from "@/features/student/shell";

function priceLabel(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency,
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export default function CoursesPage() {
  const courses = useGetStudentCoursesQuery();

  if (courses.isLoading) return <CourseListSkeleton />;

  return <StudentPage>
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-[22px] font-semibold text-[#0A1931]">Skill courses</h1>
        <button type="button" aria-label="Refresh courses" disabled={courses.isFetching} onClick={() => void courses.refetch()} className="grid h-10 w-10 place-items-center rounded-full border border-[#E7E0D4] bg-white text-[#5F4DB2] disabled:opacity-60"><RefreshCw size={18} className={courses.isFetching ? "animate-spin" : ""} /></button>
      </header>
      {courses.error && courses.data ? <p role="alert" className="text-[13px] text-[#A33A2B]">Could not refresh courses. Your last results are shown.</p> : null}
      {courses.data && !courses.data.some((course) => course.purchased) && <section className="rounded-[22px] border border-[#DED0F4] bg-[#FAF5FF] p-5 sm:p-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF3C7] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#9A4C17]"><Sparkles size={13} /> Bharatpath Score advantage</span>
        <h2 className="mt-3 text-[22px] font-semibold tracking-[-0.03em] text-[#0A1931]">Earn up to +30 points</h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#3A4761]">Complete certified video courses to improve your CV and unlock stronger matching opportunities.</p>
      </section>}

      {courses.error && !courses.data ? <StudentErrorState icon={<BookOpen size={22} />} title="Courses unavailable" error={courses.error} fallback="Could not load courses right now." />
        : courses.data?.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{courses.data.map((course) => <Link
          key={course.id}
          href={`/student/courses/${course.id}`}
          className={`flex flex-col gap-3 rounded-[22px] border border-[#E7E0D4] bg-white p-5 text-[#0A1931] ${interactiveCardClass}`}
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="min-w-0 flex-1 text-[18px] font-semibold leading-6 tracking-[-0.02em] text-[#0A1931]">{course.title}</h2>
            <StatusChip tone={course.completed ? "paid" : course.locked ? "waiting" : "advanced"} icon={course.completed ? <CircleCheck size={12} /> : course.locked ? <LockKeyhole size={12} /> : undefined}>
              {course.completed ? "Completed" : course.locked ? priceLabel(course.priceMinor, course.currency) : "Enrolled"}
            </StatusChip>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-[#5F6B80]"><span className="inline-flex items-center gap-1.5"><BookOpen size={15} /> {course.lessonsTotal} {course.lessonsTotal === 1 ? "lesson" : "lessons"}</span><span className="inline-flex items-center gap-1.5"><Clock3 size={15} /> Self-paced video</span></div>
          {course.purchased ? <div className="pt-1"><div className="mb-2 flex items-center justify-between text-[12px] text-[#5F6B80]"><span className="font-semibold text-[#5F4DB2]">{course.percentComplete}% done</span><span>{course.lessonsCompleted} of {course.lessonsTotal} completed</span></div><MeterBar value={course.percentComplete} /></div> : null}
          <div className="mt-auto flex items-center justify-between border-t border-[#F0EBDF] pt-3.5 text-[13px] font-semibold text-[#5F4DB2]"><span>{course.completed ? "Review course" : course.purchased ? (course.percentComplete ? "Continue learning" : "Start learning") : "View syllabus"}</span><ChevronRight size={17} /></div>
        </Link>)}</div>
        : <EmptyState icon={<BookOpen size={22} />} title="No courses available" message="Courses will appear here when they are published." />}
    </div>
  </StudentPage>;
}
