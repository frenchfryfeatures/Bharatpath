"use client";

import { ImageUploader } from "@/components/profile-image/image-uploader";
import { identityDisplayLabel } from "@/lib/auth/use-session-identity";
import { useAppSelector } from "@/store/hooks";

/** The signed-in person's own photo, for any role. */
export function ProfilePhotoCard({ name, embedded = false }: { name?: string; embedded?: boolean }) {
  const user = useAppSelector((state) => state.auth.user);

  return (
    <ImageUploader
      target="photo"
      embedded={embedded}
      name={name ?? identityDisplayLabel(user, "You")}
      title="Profile photo"
      description="Upload a JPEG, PNG or WebP image up to 5 MB. You can replace or remove your photo anytime."
    />
  );
}
