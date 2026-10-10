"use client";

import { BookOpen, CheckCircle2, LockKeyhole, ShoppingCart } from "lucide-react";

import {
  useCheckoutCourseMutation,
  useGetStudentCoursesQuery,
} from "@/store/student";
import {
  CommerceBadge,
  EmptyState,
  PillButton,
  StatusChip,
  StudentCard,
  StudentErrorState,
} from "@/features/student/components";
import { StudentPage, StudentTopBar } from "@/features/student/shell";
import { CourseGridSkeleton } from "./course-skeletons";

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: currency || "INR",
    minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

export function CourseCatalogue() {
  const courses = useGetStudentCoursesQuery();
  const [checkout, checkoutState] = useCheckoutCourseMutation();

  async function buy(courseId: string) {
    const result = await checkout(courseId).unwrap();
    if (result.redirect_url) window.location.assign(result.redirect_url);
  }

  return (
    <StudentPage>
      <div className="flex flex-col gap-5">
        <StudentTopBar title="Courses" />
        <p className="text-[15px] leading-6 text-[#3A4761]">
          Buy a course once, then return here to access it at any time.
        </p>

        {courses.isLoading ? (
          <CourseGridSkeleton />
        ) : courses.error ? (
          <StudentErrorState
            title="Courses unavailable"
            error={courses.error}
            fallback="Could not load courses."
            onRetry={() => void courses.refetch()}
          />
        ) : courses.data?.length ? (
          <div className="grid gap-4 lg:grid-cols-2">
            {courses.data.map((course) => (
              <StudentCard key={course.id} className="flex flex-col gap-4">
                <div className="flex items-start gap-3">
                  <span className="rounded-xl bg-[#EEEAF8] p-3 text-[#5F4DB2]">
                    <BookOpen size={22} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[18px] font-bold text-[#0A1931]">{course.title}</h2>
                    <p className="mt-1 text-[12px] text-[#5F6B80]">{course.code}</p>
                  </div>
                  <CommerceBadge>{money(course.priceMinor, course.currency)}</CommerceBadge>
                </div>

                <div>
                  {course.completed ? (
                    <StatusChip tone="paid" icon={<CheckCircle2 size={12} />}>Completed</StatusChip>
                  ) : course.purchased ? (
                    <StatusChip tone="paid" icon={<CheckCircle2 size={12} />}>Purchased</StatusChip>
                  ) : (
                    <StatusChip icon={<LockKeyhole size={12} />}>Locked until purchase</StatusChip>
                  )}
                </div>

                {course.purchased ? (
                  <p className="text-[14px] text-[#3A4761]">
                    This course is attached to your account. Lesson access will appear here as content is published.
                  </p>
                ) : (
                  <PillButton
                    icon={<ShoppingCart size={16} />}
                    disabled={checkoutState.isLoading}
                    onClick={() => void buy(course.id)}
                  >
                    {checkoutState.isLoading ? "Starting checkout…" : "Buy course"}
                  </PillButton>
                )}
              </StudentCard>
            ))}
          </div>
        ) : (
          <EmptyState title="No courses available" message="Published courses will appear here." />
        )}

        {checkoutState.error ? (
          <StudentErrorState
            variant="inline"
            error={checkoutState.error}
            fallback="Checkout could not start. Please try again."
          />
        ) : null}
      </div>
    </StudentPage>
  );
}
