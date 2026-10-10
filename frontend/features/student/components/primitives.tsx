"use client";

import { useState, type ReactNode } from "react";

/*
 * ==========================================================================
 * STUDENT PORTAL - SHARED PRIMITIVES
 *
 * The mobile candidate app has its own visual language (pill buttons, tinted
 * status chips, note strips, meters) that the desktop portal components cannot
 * express without distortion, so these are Student-specific by design.
 * ==========================================================================
 */

/* -------------------------------------------------------------------------
 * Interactive card - the hover/press/focus treatment for any clickable
 * surface (job, application and add-on cards, stat tiles, settings rows).
 * Pair it with a surface's own border and background.
 * ---------------------------------------------------------------------- */
export const interactiveCardClass =
  "cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:border-[#CFC6B4] hover:shadow-[0_10px_24px_rgba(10,25,49,0.07)] active:translate-y-0 active:scale-[.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30";

/* -------------------------------------------------------------------------
 * Card - the workhorse white surface.
 * ---------------------------------------------------------------------- */
export function StudentCard({
  children,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={[
        "rounded-[20px] border border-[#E7E0D4] bg-white",
        padded ? "p-4" : "",
        className,
      ].join(" ")}
    >
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Section eyebrow - mono uppercase label that opens a section.
 * ---------------------------------------------------------------------- */
export function SectionEyebrow({
  children,
  icon,
  action,
}: {
  children: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex flex-1 items-center gap-2 text-[11px] font-bold uppercase leading-3 tracking-[0.12em] text-[#5F6B80]">
        {icon ? <span className="text-[#B9891A]">{icon}</span> : null}
        {children}
      </span>
      {action}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Status chip - one taxonomy, tint bg + same-hue ink.
 * ---------------------------------------------------------------------- */
export type ChipTone =
  | "match"
  | "short"
  | "advanced"
  | "waiting"
  | "expiring"
  | "paid"
  | "neutral"
  | "band";

const CHIP_TONES: Record<ChipTone, string> = {
  match: "bg-[#E6F1EA] text-[#1F6B45]",
  short: "bg-[#F7EFD6] text-[#7A5C0E]",
  advanced: "bg-[#E6F1EA] text-[#1F6B45]",
  waiting: "bg-[#F7F4EC] text-[#5F6B80]",
  expiring: "bg-[#F7EFD6] text-[#7A5C0E]",
  paid: "bg-[#E6F1EA] text-[#1F6B45]",
  neutral: "bg-[#F7F4EC] text-[#5F6B80]",
  band: "bg-[rgba(244,214,133,0.16)] text-[#B9891A]",
};

export function StatusChip({
  children,
  tone = "neutral",
  icon,
}: {
  children: ReactNode;
  tone?: ChipTone;
  icon?: ReactNode;
}) {
  return (
    <span
      className={[
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[10px] font-bold uppercase leading-3 tracking-[0.06em]",
        CHIP_TONES[tone],
      ].join(" ")}
    >
      {icon}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Commerce badge - gold-border pill for FREE / prices only.
 * ---------------------------------------------------------------------- */
export function CommerceBadge({
  children,
  icon,
}: {
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[#D4AF37] bg-white px-3 py-1.5 text-[11px] font-bold uppercase leading-3 tracking-[0.08em] text-[#0A1931]">
      {icon ? <span className="text-[#B9891A]">{icon}</span> : null}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Pill button - the app's primary action shape.
 * ---------------------------------------------------------------------- */
export type PillVariant =
  | "primary"
  | "secondary"
  | "in-card"
  | "tertiary";

const PILL_VARIANTS: Record<PillVariant, string> = {
  primary: "bg-[#5F4DB2] text-white enabled:hover:bg-[#4A3E8F]",
  secondary:
    "border border-[#DDD6C7] bg-white text-[#0A1931] enabled:hover:border-[#CFC6B4] enabled:hover:bg-[#F7F4EC]",
  "in-card":
    "border border-[#0A1931] bg-white text-[#0A1931] enabled:hover:bg-[#0A1931] enabled:hover:text-white",
  tertiary: "bg-transparent text-[#5F6B80] enabled:hover:text-[#0A1931]",
};

export function PillButton({
  children,
  variant = "primary",
  onClick,
  className = "",
  type = "button",
  icon,
  "aria-label": ariaLabel,
  disabled = false,
}: {
  children: ReactNode;
  variant?: PillVariant;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
  icon?: ReactNode;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  const shape =
    variant === "tertiary"
      ? "px-2 py-2 text-[14px]"
      : "rounded-full px-4 py-4 text-[15px]";

  return (
    <button
      type={type}
      onClick={onClick}
      aria-label={ariaLabel}
      disabled={disabled}
      className={[
        "inline-flex items-center justify-center gap-2 font-semibold leading-5 transition-all active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30",
        shape,
        PILL_VARIANTS[variant],
        className,
      ].join(" ")}
    >
      {icon}
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------
 * Icon circle button - 40px round action.
 * ---------------------------------------------------------------------- */
export function IconCircleButton({
  children,
  onClick,
  tone = "cream",
  "aria-label": ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  tone?: "cream" | "navy" | "glass";
  "aria-label": string;
}) {
  const tones: Record<string, string> = {
    cream:
      "border border-[#E7E0D4] bg-white text-[#0A1931] hover:border-[#CFC6B4] hover:bg-[#F7F4EC]",
    navy: "border border-[rgba(10,25,49,0.26)] bg-[#0A1931] text-white hover:bg-[#1B2C4A]",
    glass:
      "border border-[rgba(255,252,247,0.26)] bg-[rgba(255,252,247,0.08)] text-white hover:bg-[rgba(255,252,247,0.18)]",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className={[
        "grid h-10 w-10 shrink-0 place-items-center rounded-full transition-all active:scale-[.96] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30",
        tones[tone],
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* -------------------------------------------------------------------------
 * Note strip - reassurance / state line with an icon.
 * ---------------------------------------------------------------------- */
export function NoteStrip({
  children,
  icon,
  tone = "cream",
}: {
  children: ReactNode;
  icon?: ReactNode;
  tone?: "cream" | "indigo" | "amber";
}) {
  const tones: Record<string, string> = {
    cream: "bg-[#F7F4EC] text-[#3A4761]",
    indigo: "bg-[#F1EAF7] text-[#0A1931]",
    amber: "bg-[#F7EFD6] text-[#3A4761]",
  };

  return (
    <div
      className={[
        "flex items-start gap-2.5 rounded-2xl p-4 text-[12px] leading-[18px]",
        tones[tone],
      ].join(" ")}
    >
      {icon ? <span className="mt-0.5 shrink-0 text-[#5F6B80]">{icon}</span> : null}
      <span className="flex-1">{children}</span>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Skill chip - on-resume / missing / addable.
 * ---------------------------------------------------------------------- */
export function SkillChip({
  children,
  variant = "have",
  icon,
}: {
  children: ReactNode;
  variant?: "have" | "missing" | "add";
  icon?: ReactNode;
}) {
  const variants: Record<string, string> = {
    have: "bg-[#E6F1EA] text-[#1F6B45]",
    missing: "border border-dashed border-[#DDD6C7] bg-[#F7F4EC] text-[#5F6B80]",
    add: "bg-[#F7EFD6] text-[#0A1931]",
  };

  return (
    <span
      className={[
        "inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-medium leading-4",
        variants[variant],
      ].join(" ")}
    >
      {icon}
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Meter bar - 5px indigo fill on a hairline track.
 * ---------------------------------------------------------------------- */
export function MeterBar({
  value,
  emphasis = "strong",
  height = 5,
}: {
  value: number;
  emphasis?: "strong" | "weak";
  height?: number;
}) {
  const fill = emphasis === "weak" ? "#7E6FBF" : "#5F4DB2";
  return (
    <span
      className="block overflow-hidden rounded-full bg-[#F0EBDF]"
      style={{ height }}
    >
      <span
        className="block h-full rounded-full transition-[width] duration-700"
        style={{ width: `${Math.min(100, Math.max(0, value))}%`, background: fill }}
      />
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Monogram tile - company / add-on initials in a navy or tinted square.
 * ---------------------------------------------------------------------- */
export function MonogramTile({
  children,
  tint = "indigo",
  size = 44,
  logoUrl,
}: {
  children: ReactNode;
  tint?: "navy" | "indigo" | "amber";
  size?: number;
  /** The employer's logo. Falls back to the monogram when absent or broken. */
  logoUrl?: string | null;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const tints: Record<string, string> = {
    navy: "bg-[#0A1931] text-[#F4D685]",
    indigo: "bg-[#F1EAF7] text-[#4A3E8F]",
    amber: "bg-[#F7EFD6] text-[#7A5C0E]",
  };

  if (logoUrl && failedUrl !== logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- presigned, expiring URL
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        onError={() => setFailedUrl(logoUrl)}
        className="shrink-0 rounded-[14px] border border-[#E7E0D4] bg-white object-contain"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <span
      className={[
        "grid shrink-0 place-items-center rounded-[14px] text-[14px] font-bold leading-4",
        tints[tint],
      ].join(" ")}
      style={{ width: size, height: size }}
    >
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * Empty state - neutral placeholder, no fabricated data.
 * ---------------------------------------------------------------------- */
export function EmptyState({
  icon,
  title,
  message,
  action,
}: {
  icon?: ReactNode;
  title: string;
  message: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[20px] border border-dashed border-[#E7E0D4] bg-white px-6 py-12 text-center">
      {icon ? (
        <span className="grid h-12 w-12 place-items-center rounded-full bg-[#F7F4EC] text-[#5F6B80]">
          {icon}
        </span>
      ) : null}
      <span className="text-[16px] font-bold tracking-[-0.02em] text-[#0A1931]">
        {title}
      </span>
      <span className="max-w-[260px] text-[13px] leading-[19px] text-[#5F6B80]">
        {message}
      </span>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Sticky CTA band - the action bar that ends a scrolling screen.
 * ---------------------------------------------------------------------- */
export function CtaBand({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 mt-auto bg-linear-to-t from-[#FFFCF7] via-[#FFFCF7] to-transparent px-5 pb-6 pt-3">
      {children}
    </div>
  );
}
