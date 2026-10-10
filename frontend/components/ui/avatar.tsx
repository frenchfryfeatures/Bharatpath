import React, { useState } from "react";

export interface AvatarProps {
  name: string;
  /** A photo or logo URL. Falls back to initials when absent or broken. */
  src?: string | null;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZE_CLASSES = {
  sm: "h-7 w-7 text-[11px]",
  md: "h-9 w-9 text-[12px]",
  lg: "h-11 w-11 text-[14px]",
};

export function Avatar({ name, src, size = "md", className = "" }: AvatarProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const initials = name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "BP";

  if (src && failedSrc !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- presigned, expiring URL
      <img
        src={src}
        alt=""
        onError={() => setFailedSrc(src)}
        className={`shrink-0 rounded-[8px] bg-[#edf1f8] object-cover select-none ${SIZE_CLASSES[size]} ${className}`}
      />
    );
  }

  return (
    <div
      className={`grid shrink-0 place-items-center rounded-[8px] bg-[#edf1f8] font-bold text-[#2a3447] select-none ${SIZE_CLASSES[size]} ${className}`}
      style={{ fontFamily: "'General Sans', sans-serif" }}
    >
      {initials}
    </div>
  );
}
