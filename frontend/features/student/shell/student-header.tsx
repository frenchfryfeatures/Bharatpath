"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";

import { useGetStudentProfileQuery } from "@/store/student";
import { initials } from "@/features/student/formatters";
import { NotificationCenter } from "@/features/notifications";

import { StudentStreak } from "./student-streak";

/*
 * ==========================================================================
 * STUDENT HEADER
 *
 * The full-width top bar, following the project header convention (title +
 * subtitle on the left, actions on the right). Carries the two sidebar toggles:
 * a hamburger that opens the mobile drawer, and a collapse button on desktop.
 * ==========================================================================
 */

interface Section {
  title: string;
  subtitle: string;
}

function sectionFor(pathname: string): Section {
  if (pathname === "/student") {
    return { title: "Home", subtitle: "Your job search at a glance" };
  }
  if (pathname.startsWith("/student/jobs")) {
    return { title: "Jobs", subtitle: "Roles matched to your score" };
  }
  if (pathname.startsWith("/student/board")) {
    return { title: "Board", subtitle: "Where your applications stand" };
  }
  if (pathname.startsWith("/student/score")) {
    return { title: "Your score", subtitle: "How your resume reads to employers" };
  }
  if (pathname.startsWith("/student/profile")) {
    return { title: "Profile", subtitle: "Your account and privacy" };
  }
  if (pathname.startsWith("/student/privacy")) {
    return { title: "Profile visibility", subtitle: "How your profile is shared" };
  }
  if (pathname.startsWith("/student/attribute")) {
    return { title: "Attribute check", subtitle: "How you like to work" };
  }
  if (pathname.startsWith("/student/interview")) {
    return { title: "Mock interview", subtitle: "Practise before it counts" };
  }
  return { title: "BharatPath", subtitle: "" };
}

export function StudentHeader({
  onOpenDrawer,
}: {
  onOpenDrawer: () => void;
}) {
  const pathname = usePathname();
  const { data: profile } = useGetStudentProfileQuery();
  const { title, subtitle } = sectionFor(pathname);

  return (
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-[#E7E0D4] bg-white px-3 sm:px-4">
      {/* Mobile: open drawer */}
      <button
        type="button"
        onClick={onOpenDrawer}
        aria-label="Open menu"
        className="grid h-9 w-9 place-items-center rounded-lg text-[#0A1931] transition-colors hover:bg-[#F7F4EC] md:hidden"
      >
        <Menu size={20} />
      </button>

      {/* Title */}
      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="truncate text-[18px] font-bold leading-6 tracking-[-0.01em] text-[#0A1931]">
          {title}
        </h1>
        {subtitle ? (
          <span className="truncate text-[12px] leading-4 text-[#5F6B80]">
            {subtitle}
          </span>
        ) : null}
      </div>

      {/* Actions */}
      <StudentStreak />

      <NotificationCenter />

      <Link
        href="/student/profile"
        aria-label="Your profile"
        className="grid h-9 w-9 place-items-center rounded-full bg-[#5F4DB2] text-[12px] font-bold text-white transition-all hover:bg-[#4A3E8F] hover:ring-2 hover:ring-[#C9BEEB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/40"
      >
        {initials(profile?.fullName)}
      </Link>
    </header>
  );
}
