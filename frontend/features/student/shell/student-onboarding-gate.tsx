"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { AccountDestinationLoading } from "@/components/common/account-destination-loading";
import { useSessionIdentity } from "@/lib/auth/use-session-identity";
import { useGetCareerProfileQuery } from "@/features/student/profile/career-api";
import { isStudentOnboardingComplete } from "@/features/student/onboarding/onboarding-status";
import { useGetResumeVersionsQuery, useGetStudentProfileQuery } from "@/store/student";

export function StudentOnboardingGate({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, isResolving } = useSessionIdentity();
  const role = user?.role;
  const skip = role !== "STUDENT" || user?.backendRole === "NO_ACTIVE_MEMBERSHIP";
  const profile = useGetStudentProfileQuery(undefined, { skip });
  const career = useGetCareerProfileQuery(undefined, { skip });
  const versions = useGetResumeVersionsQuery(undefined, { skip });
  const checking = profile.isLoading || career.isLoading || versions.isLoading;
  const complete = Boolean(
    profile.data && career.data && versions.data &&
    isStudentOnboardingComplete(profile.data, career.data, versions.data),
  );

  useEffect(() => {
    if (!user && !isResolving) {
      router.replace("/login");
      return;
    }
    if (role && role !== "STUDENT") {
      router.replace("/login");
      return;
    }
    if (user?.backendRole === "NO_ACTIVE_MEMBERSHIP") {
      router.replace("/signup/student");
      return;
    }
    if (role === "STUDENT" && !checking && profile.data && career.data && versions.data && !complete) {
      router.replace("/signup/student");
    }
  }, [user, isResolving, role, profile.data, career.data, versions.data, complete, checking, router]);

  if (profile.isError || career.isError || versions.isError) {
    return (
      <div className="mx-auto max-w-md p-8 text-center text-sm text-[#3A4761]">
        <p>Could not check your onboarding progress.</p>
        <button
          type="button"
          className="mt-4 rounded-full bg-[#5F4DB2] px-5 py-2 font-semibold text-white"
          onClick={() => {
            void profile.refetch();
            void career.refetch();
            void versions.refetch();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!complete || checking) {
    return <AccountDestinationLoading />;
  }

  return <>{children}</>;
}
