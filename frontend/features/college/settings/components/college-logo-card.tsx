"use client";

import { ProfileImageEditor } from "@/components/profile-image/profile-image-editor";
import { useSessionIdentity } from "@/lib/auth/use-session-identity";
import { useGetCollegeOrganisationQuery } from "@/store/college/settings/settings.api";

/** Admin and staff see the logo; only the college admin can change it. */
export function CollegeLogoCard() {
  const isAdmin = useSessionIdentity().user?.backendRole === "COLLEGE_ADMIN";
  const organisation = useGetCollegeOrganisationQuery();

  return (
    <ProfileImageEditor
      target="college-logo"
      name={organisation.data?.name ?? "College"}
      title="College logo"
      description="Shown on your college pages. Only the college admin can change it."
      canEdit={isAdmin}
    />
  );
}
