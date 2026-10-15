import React from "react";
import { Hourglass, Link as LinkIcon, Send } from "lucide-react";

export type LinkState = "linked" | "invited" | "consent_pending";

interface LinkStateConfig {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string; strokeWidth?: number }>;
  bgClass: string;
  textClass: string;
}

const LINK_STATE_CONFIGS: Record<LinkState, LinkStateConfig> = {
  linked: {
    label: "Linked",
    icon: LinkIcon,
    bgClass: "bg-[#eaf5ef]",
    textClass: "text-[#23805d]",
  },
  invited: {
    label: "Invited",
    icon: Send,
    bgClass: "bg-[#edf2fa]",
    textClass: "text-[#3566b8]",
  },
  consent_pending: {
    label: "Consent pending",
    icon: Hourglass,
    bgClass: "bg-[#f8f1e4]",
    textClass: "text-[#8c681d]",
  },
};

export interface LinkStateBadgeProps {
  state: LinkState;
  className?: string;
  showIcon?: boolean;
}

export function LinkStateBadge({
  state,
  className = "",
  showIcon = true,
}: LinkStateBadgeProps) {
  const config = LINK_STATE_CONFIGS[state] || LINK_STATE_CONFIGS.linked;
  const Icon = config.icon;

  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-[3px] text-[12px] font-semibold leading-tight select-none ${config.bgClass} ${config.textClass} ${className}`}
      style={{ fontFamily: "'General Sans', sans-serif" }}
    >
      {showIcon && <Icon size={12} strokeWidth={2.2} className="shrink-0" />}
      <span>{config.label}</span>
    </span>
  );
}
