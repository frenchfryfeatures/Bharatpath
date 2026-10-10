"use client";

import { useRef, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";

import { Avatar, Button } from "@/components/ui";
import { getApiErrorMessage } from "@/lib/api/error-message";
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
}: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const image = useGetProfileImageQuery(target);
  const [createUpload] = useCreateProfileImageUploadMutation();
  const [uploadFile] = useUploadProfileImageFileMutation();
  const [confirm] = useConfirmProfileImageMutation();
  const [remove, removal] = useDeleteProfileImageMutation();

  const hasImage = Boolean(image.data?.url);

  const onPick = async (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

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
    <section className={`min-w-0 rounded-[12px] border border-[#e5e8ee] bg-white p-5 ${className}`}>
      <h2 className="text-[14px] font-semibold leading-[18px] text-[#172033]">{title}</h2>
      <p className="mt-1 max-w-[530px] text-[12px] leading-[17px] text-[#7b8494]">{description}</p>

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <Avatar
          name={name}
          src={image.data?.url}
          className="!h-16 !w-16 !text-[18px]"
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
              variant="secondary"
              size="sm"
              icon={<ImagePlus size={14} />}
              isLoading={busy}
              loadingText="Uploading..."
              disabled={image.isLoading || removal.isLoading}
              onClick={() => inputRef.current?.click()}
            >
              {hasImage ? "Replace" : "Upload"}
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
      </div>

      <p className="mt-3 text-[11px] leading-4 text-[#7b8494]">JPEG, PNG or WebP.</p>

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
