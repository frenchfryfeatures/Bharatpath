"use client";

import Link from "next/link";
import { BookOpen, ChevronRight, CircleCheck, Clock3, LockKeyhole, Sparkles } from "lucide-react";

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
      <section className="rounded-[22px] border border-[#DED0F4] bg-[#FAF5FF] p-5 sm:p-6">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF3C7] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#9A4C17]"><Sparkles size={13} /> Readiness advantage</span>
        <h2 className="mt-3 text-[22px] font-bold tracking-[-0.03em] text-[#0A1931]">Learn skills that strengthen your profile</h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#3A4761]">Complete certified video courses to improve your CV and unlock stronger matching opportunities.</p>
      </section>

      {courses.error ? <StudentErrorState icon={<BookOpen size={22} />} title="Courses unavailable" error={courses.error} fallback="Could not load courses right now." />
        : courses.data?.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{courses.data.map((course) => <Link
          key={course.id}
          href={`/student/courses/${course.id}`}
          className={`flex min-h-60 flex-col rounded-[22px] border border-[#E7E0D4] bg-white p-5 text-[#0A1931] ${interactiveCardClass}`}
        >
          <div className="flex items-start justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF3C7] px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-[#9A4C17]"><Sparkles size={13} /> Readiness boost</span>
            <StatusChip tone={course.completed ? "paid" : course.locked ? "waiting" : "advanced"} icon={course.completed ? <CircleCheck size={12} /> : course.locked ? <LockKeyhole size={12} /> : undefined}>
              {course.completed ? "Completed" : course.locked ? "Locked" : "In progress"}
            </StatusChip>
          </div>
          <h2 className="mt-4 text-[19px] font-bold leading-6 tracking-[-0.02em] text-[#0A1931]">{course.title}</h2>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-[#5F6B80]"><span className="inline-flex items-center gap-1.5"><BookOpen size={15} /> {course.lessonsTotal} lessons</span><span className="inline-flex items-center gap-1.5"><Clock3 size={15} /> Self-paced video</span></div>
          {course.purchased ? <div className="mt-4"><div className="mb-2 flex items-center justify-between text-[12px] text-[#5F6B80]"><span className="font-semibold text-[#5F4DB2]">{course.percentComplete}% done</span><span>{course.lessonsCompleted} of {course.lessonsTotal} completed</span></div><MeterBar value={course.percentComplete} /></div> : <p className="mt-3 text-[13px] text-[#5F6B80]">Unlock all lessons for {priceLabel(course.priceMinor, course.currency)}.</p>}
          <div className="mt-auto flex items-center justify-between border-t border-[#F0EBDF] pt-4 text-[13px] font-semibold text-[#5F4DB2]"><span>{course.purchased ? course.percentComplete ? "Continue learning" : "Start learning" : "Explore course"}</span><ChevronRight size={17} /></div>
        </Link>)}</div>
        : <EmptyState icon={<BookOpen size={22} />} title="No courses available" message="Courses will appear here when they are published." />}
    </div>
  </StudentPage>;
}
