import { LucideIcon } from "lucide-react";

export type MetricTone =
  | "purple"
  | "green"
  | "blue"
  | "orange"
  | "red"
  | "amber"
  | "navy";

export type MetricStatusTone =
  | "success"
  | "warning"
  | "danger"
  | "neutral";

const toneClasses: Record<MetricTone, string> = {
  purple: "bg-[#eef0ff] text-[#4e43b7]",
  green: "bg-[#e6f6ec] text-[#1f8a4c]",
  blue: "bg-[#e8f1fe] text-[#2563b0]",
  orange: "bg-[#fdf1e0] text-[#b5650b]",
  red: "bg-[#fdecec] text-[#c43d3d]",
  amber: "bg-[#fff4df] text-[#a86500]",
  navy: "bg-[#f1f3f6] text-[#151b2b]",
};

const statusToneClasses: Record<MetricStatusTone, string> = {
  success: "bg-[#e6f6ec] text-[#1f8a4c]",
  warning: "bg-[#fff4df] text-[#a86500]",
  danger: "bg-[#fdecec] text-[#c43d3d]",
  neutral: "bg-[#f1f3f6] text-[#697386]",
};

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  tone: MetricTone;

  /**
   * Optional status shown underneath the metric title.
   */
  status?: string;

  /**
   * Controls the visual tone of the optional status.
   */
  statusTone?: MetricStatusTone;

  /**
   * Optional click handler.
   */
  onClick?: () => void;
}

export function MetricCard({
  title,
  value,
  icon: Icon,
  tone,
  status,
  statusTone = "neutral",
  onClick,
}: Readonly<MetricCardProps>) {
  const Component = onClick ? "button" : "div";

  return (
    <Component
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={[
        "w-full rounded-2xl border border-[#e5e7ec] bg-white px-6 py-5 text-left",
        "transition-all duration-150 hover:-translate-y-px hover:border-[#d9dce4] hover:shadow-[0_6px_18px_rgba(19,26,38,0.05)]",
        onClick
          ? "cursor-pointer focus:outline-none focus:ring-2 focus:ring-[#5b4fcf]/20"
          : "",
      ].join(" ")}
    >
      {/* Value + Icon */}
      <div className="flex items-start justify-between gap-4">
        <p
          className="text-[28px] font-bold leading-9.5 tracking-[-0.02em] text-[#151b2b]"
          style={{
            fontFamily: "'General Sans', sans-serif",
          }}
        >
          {value}
        </p>

        <div
          className={[
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-[11px]",
            toneClasses[tone],
          ].join(" ")}
        >
          <Icon size={16} strokeWidth={2} />
        </div>
      </div>

      {/* Title */}
      <p
        className="mt-0 text-[12px] font-normal leading-5 text-[#777f90]"
        style={{
          fontFamily: "'General Sans', sans-serif",
        }}
      >
        {title}
      </p>

      {/* Optional Status */}
      {status && (
        <div className="mt-3">
          <span
            className={[
              "inline-flex items-center rounded-full px-2.5 py-1",
              "text-[11px] font-semibold leading-3.75",
              statusToneClasses[statusTone],
            ].join(" ")}
            style={{
              fontFamily: "'General Sans', sans-serif",
            }}
          >
            {status}
          </span>
        </div>
      )}
    </Component>
  );
}