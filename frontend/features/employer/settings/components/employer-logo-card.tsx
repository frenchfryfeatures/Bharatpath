"use client";

import { ProfileImageEditor } from "@/components/profile-image/profile-image-editor";
import { useSessionIdentity } from "@/lib/auth/use-session-identity";
import { useGetEmployerOrganisationQuery } from "@/store/employer/settings";

/** Any member sees the logo; only the owner can change it. */
export function EmployerLogoCard() {
  const isOwner = useSessionIdentity().user?.backendRole === "EMPLOYER_OWNER";
  const organisation = useGetEmployerOrganisationQuery();

  return (
    <ProfileImageEditor
      target="employer-logo"
      name={organisation.data?.legalName ?? "Company"}
      title="Company logo"
      description="Candidates see this next to your jobs. Only the account owner can change it."
      canEdit={isOwner}
    />
  );
}
