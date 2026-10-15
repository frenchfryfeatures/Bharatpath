export type StatusBadgeTone =
  | "success"
  | "info"
  | "neutral"
  | "muted"
  | "warning";

export interface StatusBadgeProps {
  label: string;
  tone?: StatusBadgeTone;
  className?: string;
}

const TONE_CLASSES: Record<StatusBadgeTone, string> = {
  success: "bg-[#eaf5ef] text-[#23805d]",
  info: "bg-[#edf2fa] text-[#3566b8]",
  warning: "bg-[#f8f1e4] text-[#8c681d]",
  neutral: "bg-[#eef1f6] text-[#4f5869]",
  muted: "bg-[#f0f2f5] text-[#717a8a]",
};

export function StatusBadge({
  label,
  tone = "muted",
  className = "",
}: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-semibold leading-tight ${TONE_CLASSES[tone]} ${className}`}
      style={{ fontFamily: "'General Sans', sans-serif" }}
    >
      {label}
    </span>
  );
}
