import type { ReactNode } from "react";

/*
 * ==========================================================================
 * STUDENT PAGE — the responsive content container. Every student route uses
 * the same content width and gutters so detail screens do not jump inward.
 * ==========================================================================
 */

export function StudentPage({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "mx-auto w-full max-w-[1280px] p-4",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
