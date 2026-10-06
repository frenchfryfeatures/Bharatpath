import type { ReactNode } from "react";

/*
 * ==========================================================================
 * STUDENT PAGE - the responsive content container. Every student route uses
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
        "w-full px-3 py-4 sm:px-4",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}
