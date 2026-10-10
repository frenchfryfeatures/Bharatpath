"use client";

import { useState } from "react";

interface ImageTileProps {
  /** A presigned, expiring photo or logo URL. Initials show when absent or broken. */
  src?: string | null;
  initials: string;
  /** Size, radius, colours and text style of the tile, shared by image and initials. */
  className: string;
  /** Logos keep their whole shape; photos fill the tile. */
  fit?: "cover" | "contain";
}

/** A small photo or logo that falls back to initials in the same box. */
export function ImageTile({ src, initials, className, fit = "cover" }: Readonly<ImageTileProps>) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src && failedSrc !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- presigned, expiring URL
      <img
        src={src}
        alt=""
        onError={() => setFailedSrc(src)}
        className={`${className} shrink-0 select-none overflow-hidden ${
          fit === "contain" ? "border border-[#e5e7eb] bg-white object-contain" : "object-cover"
        }`}
      />
    );
  }

  return <span className={`${className} grid shrink-0 place-items-center`}>{initials}</span>;
}
