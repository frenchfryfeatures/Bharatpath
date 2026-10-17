"use client";

import React, { useEffect, useRef, useState } from "react";

type LoadingImageProps = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string;
};

/**
 * An <img> that shows the shared shimmer skeleton in its own box until the
 * file has loaded (or failed, so the caller's onError fallback takes over).
 * Use it for every photo and logo, which come from presigned URLs and are
 * slow enough to be seen arriving.
 */
export function LoadingImage({
  src,
  className = "",
  onLoad,
  onError,
  alt = "",
  ...props
}: Readonly<LoadingImageProps>) {
  const ref = useRef<HTMLImageElement>(null);
  const [settledSrc, setSettledSrc] = useState<string | null>(null);
  const settled = settledSrc === src;

  // A cached image can finish before React attaches onLoad.
  useEffect(() => {
    if (ref.current?.complete) setSettledSrc(src);
  }, [src]);

  return (
    // eslint-disable-next-line @next/next/no-img-element -- presigned, expiring URL
    <img
      {...props}
      ref={ref}
      src={src}
      alt={alt}
      aria-busy={!settled}
      onLoad={(event) => {
        setSettledSrc(src);
        onLoad?.(event);
      }}
      onError={(event) => {
        setSettledSrc(src);
        onError?.(event);
      }}
      className={`${className} ${settled ? "" : "bp-img-loading"}`}
    />
  );
}
