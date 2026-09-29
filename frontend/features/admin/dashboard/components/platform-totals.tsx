import {
  Briefcase,
  Building2,
  CheckCircle2,
  GraduationCap,
  ListChecks,
  User,
} from "lucide-react";

import type {
  PlatformTotal,
} from "@/store/admin/dashboard/slice";

interface PlatformTotalsProps {
  items: PlatformTotal[];
}

const PLATFORM_ICONS = {
  Candidates: {
    icon: User,
    wrapper: "bg-[#f1f3f6]",
    color: "text-[#151b2b]",
  },

  Employers: {
    icon: Building2,
    wrapper: "bg-[#eef0ff]",
    color: "text-[#4e43b7]",
  },

  Institutions: {
    icon: GraduationCap,
    wrapper: "bg-[#e6f6ec]",
    color: "text-[#1f8a4c]",
  },

  "Published jobs": {
    icon: Briefcase,
    wrapper: "bg-[#e8f1fe]",
    color: "text-[#2563b0]",
  },

  Applications: {
    icon: ListChecks,
    wrapper: "bg-[#fdf1e0]",
    color: "text-[#b5650b]",
  },

  "Confirmed hires": {
    icon: CheckCircle2,
    wrapper: "bg-[#e6f6ec]",
    color: "text-[#1f8a4c]",
  },
} as const;

export function PlatformTotals({
  items,
}: PlatformTotalsProps) {
  return (
    <section className="rounded-[12px] border border-[#e5e7ec] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.025)]">
      <h2
        className="text-[14px] font-semibold leading-[18px] text-[#151b2b]"
        style={{
          fontFamily: "'General Sans', sans-serif",
        }}
      >
        Platform totals
      </h2>

      <div className="mt-3">
        {items.map((item, index) => {
          const config =
            PLATFORM_ICONS[
              item.label as keyof typeof PLATFORM_ICONS
            ];

          const Icon = config?.icon ?? User;

          return (
            <div
              key={item.label}
              className={`flex items-center gap-2.5 py-3 ${
                index === 0
                  ? "pt-1"
                  : "border-t border-[#eef0f3]"
              }`}
            >
              <div
                className={`grid h-8 w-8 place-items-center rounded-lg ${
                  config?.wrapper ?? "bg-[#f1f3f6]"
                }`}
              >
                <Icon
                  className={`h-4 w-4 ${
                    config?.color ?? "text-[#151b2b]"
                  }`}
                />
              </div>

              <span
                className="flex-1 text-[13px] font-medium text-[#4b5565]"
                style={{
                  fontFamily: "'General Sans', sans-serif",
                }}
              >
                {item.label}
              </span>

              <span
                className="text-[15px] font-bold text-[#151b2b]"
                style={{
                  fontFamily: "'General Sans', sans-serif",
                }}
              >
                {item.value}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}