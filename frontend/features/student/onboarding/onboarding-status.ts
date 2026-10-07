import type { CareerProfile } from "@/features/student/profile/career-api";
import type { StudentProfile } from "@/features/student/types";
import type { ResumeVersionSummary } from "@/store/student/resume.api";

/** Use saved server state, rather than a browser flag, to finish onboarding. */
export function isStudentOnboardingComplete(
  profile: StudentProfile,
  career: CareerProfile,
  versions: ResumeVersionSummary[],
): boolean {
  // A later draft must not lock an already onboarded candidate out of the portal.
  return Boolean(
    profile.fullName?.trim() &&
    career.completed &&
    versions.some((version) => version.confirmed),
  );
}
