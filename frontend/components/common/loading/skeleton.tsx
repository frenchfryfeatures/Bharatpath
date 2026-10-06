import React from "react";

export interface SkeletonProps
  extends React.HTMLAttributes<HTMLDivElement> {
  /** Width - number is px, string is passed through (e.g. "40%"). */
  width?: number | string;
  /** Height - number is px, string is passed through. */
  height?: number | string;
  /** Fully rounded (avatars, dots). Overrides radius. */
  circle?: boolean;
  /** Corner radius in px. Defaults to 8. */
  radius?: number;
}

function toDimension(value: number | string | undefined) {
  if (value === undefined) return undefined;
  return typeof value === "number" ? `${value}px` : value;
}

/**
 * Base shimmer placeholder. Every skeleton in the app composes this so the
 * animation, colour and radius stay identical across all portals.
 */
export function Skeleton({
  width,
  height,
  circle = false,
  radius = 8,
  className = "",
  style,
  ...props
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={`bp-skeleton ${className}`}
      style={{
        width: toDimension(width),
        height: toDimension(height),
        borderRadius: circle ? "9999px" : `${radius}px`,
        ...style,
      }}
      {...props}
    />
  );
}

export interface SkeletonTextProps {
  /** Number of text lines to render. */
  lines?: number;
  /** Height of each line in px. */
  lineHeight?: number;
  /** Gap between lines in px. */
  gap?: number;
  /** Width of the last line (shorter reads more natural). */
  lastLineWidth?: string;
  className?: string;
}

/** A stack of text-line placeholders for paragraphs and descriptions. */
export function SkeletonText({
  lines = 3,
  lineHeight = 12,
  gap = 8,
  lastLineWidth = "60%",
  className = "",
}: SkeletonTextProps) {
  return (
    <div className={className} style={{ display: "grid", rowGap: gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height={lineHeight}
          radius={6}
          width={i === lines - 1 ? lastLineWidth : "100%"}
        />
      ))}
    </div>
  );
}
