"use client";

import { ImageUploader } from "@/components/profile-image/image-uploader";
import { identityDisplayLabel } from "@/lib/auth/use-session-identity";
import { useAppSelector } from "@/store/hooks";

/** The signed-in person's own photo, for any role. */
export function ProfilePhotoCard({ name }: { name?: string }) {
  const user = useAppSelector((state) => state.auth.user);

  return (
    <ImageUploader
      target="photo"
      name={name ?? identityDisplayLabel(user, "You")}
      title="Profile photo"
      description="Your own photo. JPEG, PNG or WebP; it is resized and stripped of metadata when saved."
    />
  );
}
