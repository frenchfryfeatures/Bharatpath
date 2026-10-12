"use client";

import { useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { Pencil } from "lucide-react";
import { Avatar } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import { useGetProfileImageQuery, type ProfileImageTarget } from "@/store/api/profile-image-api";
import { ImageUploader, getProfileImageTheme } from "./image-uploader";

/** Compact profile avatar; image selection and cropping stay in the dialog. */
export function ProfileImageEditor({ target, name, title, description, canEdit = true }: {
  target: ProfileImageTarget;
  name: string;
  title: string;
  description: string;
  canEdit?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const image = useGetProfileImageQuery(target);
  const portal = usePathname().split("/")[1];
  const theme = getProfileImageTheme(portal);
  const avatar = <Avatar name={name} src={image.data?.url} className="!h-16 !w-16 !rounded-full !text-[22px] border-2 !border-[var(--editor-accent)] !bg-[var(--editor-track)] !text-[var(--editor-accent)]" />;

  return (
    <div className="flex items-center gap-4" style={{ "--editor-accent": theme.accent, "--editor-track": theme.track } as CSSProperties}>
      {canEdit ? <button type="button" onClick={() => setOpen(true)} aria-label={`Change ${title.toLowerCase()}`} className="relative shrink-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-offset-4" style={{ outlineColor: theme.accent }}>
        {avatar}
        <span className="absolute -right-1 -top-1 grid h-6 w-6 place-items-center rounded-full border border-[#e7e9ee] bg-white shadow-sm" style={{ color: theme.accent }}><Pencil size={12} aria-hidden="true" /></span>
      </button> : avatar}
      <div>
        <p className="text-[13px] font-semibold text-[#172033]">{name}</p>
        {canEdit ? <button type="button" onClick={() => setOpen(true)} className="mt-1 cursor-pointer text-[12px] font-medium hover:underline" style={{ color: theme.accent }}>{image.data?.url ? "Change" : "Upload"} {title.toLowerCase()}</button> : <p className="mt-1 text-[12px] text-[#7b8494]">{title}</p>}
      </div>
      <Modal open={open} title={title} onClose={() => setOpen(false)} variant="student" panelClassName="max-w-[400px] !rounded-3xl !p-6">
        <ImageUploader target={target} name={name} title={title} description={description} canEdit={canEdit} embedded onUploadComplete={() => setOpen(false)} />
      </Modal>
    </div>
  );
}
