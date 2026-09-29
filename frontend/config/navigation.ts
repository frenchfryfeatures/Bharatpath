import {
  BarChart3,
  LayoutGrid,
  Settings,
  Users,
  BriefcaseBusiness,
  Grid2X2,
  UserRoundSearch,
  ClipboardList,
  ShieldCheck,
  LayoutDashboard,
  Gavel,
  ScrollText,
  Tags,
} from "lucide-react";

export const employerNavigation = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/employer",
    icon: Grid2X2,
  },
  {
    key: "jobs",
    label: "Jobs",
    href: "/employer/jobs",
    icon: BriefcaseBusiness,
  },
  {
    key: "candidates",
    label: "Candidates",
    href: "/employer/candidates",
    icon: UserRoundSearch,
  },
  {
    key: "applications",
    label: "Applications",
    href: "/employer/applications",
    icon: ClipboardList,
  },
  {
    key: "settings",
    label: "Settings & Billing",
    href: "/employer/settings",
    icon: Settings,
  },
] as const;

export const collegeNavigation = [
  {
    key: "dashboard",
    label: "Dashboard",
    href: "/",
    icon: LayoutGrid,
  },
  {
    key: "students",
    label: "Students",
    href: "/students",
    icon: Users,
  },
  {
    key: "analytics",
    label: "Analytics & Outcomes",
    href: "/analytics",
    icon: BarChart3,
  },
  {
    key: "settings",
    label: "Settings & Billing",
    href: "/settings",
    icon: Settings,
  },
] as const;

export const adminNavigation = [
  {
    key: "operations",
    label: "Operations",
    href: "/admin/dashboard",
    icon: LayoutDashboard,
  },
  {
    key: "kyb-integrity",
    label: "KYB & Integrity",
    href: "/admin/queue",
    icon: ShieldCheck,
    badge: 10,
  },
  {
    key: "users",
    label: "Users",
    href: "/admin/users",
    icon: Users,
  },
  {
    key: "disputes",
    label: "Disputes",
    href: "/admin/disputes",
    icon: Gavel,
    badge: 3,
  },
  {
    key: "audit",
    label: "Audit trail",
    href: "/admin/audit",
    icon: ScrollText,
  },
  {
    key: "search-filters",
    label: "Attributes",
    href: "/admin/search-filters",
    icon: Tags,
  },
  {
    key: "settings",
    label: "Settings",
    href: "/admin/settings",
    icon: Settings,
  },
];