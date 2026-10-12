"use client";

import { useRef, useState, type CSSProperties } from "react";
import { usePathname } from "next/navigation";
import { ImagePlus, Trash2 } from "lucide-react";

import { Avatar, Button } from "@/components/ui";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { PhotoCropper } from "./photo-cropper";
import {
  useConfirmProfileImageMutation,
  useCreateProfileImageUploadMutation,
  useDeleteProfileImageMutation,
  useGetProfileImageQuery,
  useUploadProfileImageFileMutation,
  type ProfileImageTarget,
} from "@/store/api/profile-image-api";

interface ImageUploaderProps {
  target: ProfileImageTarget;
  /** Used for the initials shown while there is no image. */
  name: string;
  title: string;
  description: string;
  /** False hides replace and remove; the image is shown read-only. */
  canEdit?: boolean;
  className?: string;
  embedded?: boolean;
  onUploadComplete?: () => void;
}

const PHOTO_THEMES = {
  student: { accent: "#5F4DB2", hover: "#4A3E8F", surface: "#F7F5FA", track: "#E9E4F0" },
  neutral: { accent: "#334155", hover: "#1E293B", surface: "#F8FAFC", track: "#E2E8F0" },
} as const;

/** Keep student styling distinct; all other portals share a simple palette. */
export function getProfileImageTheme(portal: string) {
  return portal === "student" ? PHOTO_THEMES.student : PHOTO_THEMES.neutral;
}

const ACCEPT = "image/jpeg,image/png,image/webp";

/**
 * One uploader for a profile photo or an organisation logo. The flow is
 * upload ticket -> PUT to storage -> confirm; the server re-encodes the file,
 * so the preview is whatever `GET` returns afterwards, never the local file.
 */
export function ImageUploader({
  target,
  name,
  title,
  description,
  canEdit = true,
  className = "",
  embedded = false,
  onUploadComplete,
}: ImageUploaderProps) {
  const portal = usePathname().split("/")[1];
  const theme = getProfileImageTheme(portal);
  const themeStyle = {
    "--photo-accent": theme.accent,
    "--photo-hover": theme.hover,
    "--photo-surface": theme.surface,
    "--photo-track": theme.track,
  } as CSSProperties;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cropFile, setCropFile] = useState<File | null>(null);

  const image = useGetProfileImageQuery(target);
  const [createUpload] = useCreateProfileImageUploadMutation();
  const [uploadFile] = useUploadProfileImageFileMutation();
  const [confirm] = useConfirmProfileImageMutation();
  const [remove, removal] = useDeleteProfileImageMutation();

  const hasImage = Boolean(image.data?.url);

  const onPick = (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;
    setError(null);
    if (!ACCEPT.split(",").includes(file.type)) {
      setError("Use a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("That image is too large. The limit is 5 MB.");
      return;
    }
    setCropFile(file);
  };

  const upload = async (file: File) => {

    setError(null);
    setBusy(true);
    try {
      const ticket = await createUpload(target).unwrap();

      if (file.size > ticket.maxBytes) {
        setError(`That image is too large. The limit is ${formatBytes(ticket.maxBytes)}.`);
        return;
      }
      if (!ticket.acceptedTypes.includes(file.type)) {
        setError("Use a JPEG, PNG or WebP image.");
        return;
      }

      await uploadFile({ ticket, file }).unwrap();
      await confirm({ target, uploadId: ticket.uploadId }).unwrap();
      setCropFile(null);
      showSuccessFeedback(`${title} updated successfully.`);
      onUploadComplete?.();
    } catch (caught) {
      setError(getApiErrorMessage(caught, "Could not upload the image. Please try again."));
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async () => {
    setError(null);
    try {
      await remove(target).unwrap();
    } catch (caught) {
      setError(getApiErrorMessage(caught, "Could not remove the image. Please try again."));
    }
  };

  return (
    <section style={themeStyle} className={`${embedded ? "min-w-0" : "min-w-0 rounded-[12px] border border-[#e5e8ee] bg-white p-5"} ${className}`}>
      {!embedded && <>
        <h2 className="text-[14px] font-semibold leading-[18px] text-[#172033]">{title}</h2>
        <p className="mt-1 max-w-[530px] text-[12px] leading-[17px] text-[#7b8494]">{description}</p>
      </>}

      {cropFile ? (
        <PhotoCropper key={`${cropFile.name}-${cropFile.lastModified}`} file={cropFile} shape={target === "photo" ? "circle" : "square"} busy={busy} onCancel={() => { setCropFile(null); setError(null); }} onSave={upload} />
      ) : <div className={embedded ? "flex flex-col items-center gap-5 py-3" : "mt-4 flex flex-wrap items-center gap-4"}>
        <Avatar
          name={name}
          src={image.data?.url}
          className={embedded ? "!h-32 !w-32 !rounded-full !bg-[var(--photo-track)] !text-[32px] !text-[var(--photo-accent)] ring-4 ring-[var(--photo-surface)]" : "!h-16 !w-16 !text-[18px]"}
        />

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="hidden"
              onChange={(event) => void onPick(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant={embedded ? "primary" : "secondary"}
              className="!bg-[var(--photo-accent)] !text-white hover:!bg-[var(--photo-hover)]"
              size="sm"
              icon={<ImagePlus size={14} />}
              isLoading={busy}
              loadingText="Uploading..."
              disabled={image.isLoading || removal.isLoading}
              onClick={() => inputRef.current?.click()}
            >
              {embedded ? (hasImage ? `Choose new ${target === "photo" ? "photo" : "logo"}` : `Choose ${target === "photo" ? "photo" : "logo"}`) : (hasImage ? "Replace" : "Upload")}
            </Button>
            {hasImage ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon={<Trash2 size={14} />}
                isLoading={removal.isLoading}
                disabled={busy}
                onClick={() => void onRemove()}
              >
                Remove
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>}

      {!cropFile && <p className={`mt-3 text-[11px] leading-4 text-[#7b8494] ${embedded ? "text-center" : ""}`}>JPEG, PNG or WebP{embedded ? " · Up to 5 MB" : "."}</p>}

      {image.error ? (
        <p role="alert" className="mt-2 text-[12px] text-[#b42318]">
          {getApiErrorMessage(image.error, "Could not load the current image.")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-[12px] text-[#b42318]">
          {error}
        </p>
      ) : null}
    </section>
  );
}

function formatBytes(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(0)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}
