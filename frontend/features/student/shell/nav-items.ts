import {
  House,
  Mail,
  Briefcase,
  ListChecks,
  MicVocal,
  BookOpen,
  User,
  CreditCard,
  GraduationCap,
  type LucideIcon,
} from "lucide-react";

/*
 * ==========================================================================
 * STUDENT NAVIGATION - shared by the desktop sidebar and the mobile top nav.
 * ==========================================================================
 */

export interface StudentNavItem {
  key: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const studentNavItems: StudentNavItem[] = [
  { key: "home", label: "Home", href: "/student", icon: House },
  { key: "jobs", label: "Jobs", href: "/student/jobs", icon: Briefcase },
  { key: "invites", label: "Invites", href: "/student/invites", icon: Mail },
  { key: "board", label: "Board", href: "/student/board", icon: ListChecks },
  { key: "interview", label: "Interview", href: "/student/interview", icon: MicVocal },
  { key: "courses", label: "Courses", href: "/student/courses", icon: BookOpen },
  { key: "college", label: "College", href: "/student/college", icon: GraduationCap },
  { key: "subscription", label: "Subscription", href: "/student/subscription", icon: CreditCard },
  { key: "profile", label: "Profile", href: "/student/profile", icon: User },
];

/** Whether a nav item is active for the current pathname. */
export function isNavItemActive(href: string, pathname: string): boolean {
  if (href === "/student") {
    return pathname === "/student" || pathname.startsWith("/student/recommended-jobs/");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}
