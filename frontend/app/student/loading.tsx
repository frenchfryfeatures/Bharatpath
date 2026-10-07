"use client";

import { usePathname } from "next/navigation";
import { StudentPortalLoading } from "@/features/student/loading/student-portal-loading";

export default function StudentLoading() {
  return <StudentPortalLoading pathname={usePathname()} />;
}
