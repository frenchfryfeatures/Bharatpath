"use client";

import type { SettingsTab } from "../types";

interface SettingsTabsProps {
  activeTab: SettingsTab;
  onChange: (tab: SettingsTab) => void;
}

const tabs: Array<
  [SettingsTab, string]
> = [
  ["approval", "KYB approval"],
  ["account", "Account"],
];

export function SettingsTabs({
  activeTab,
  onChange,
}: SettingsTabsProps) {
  return (
    <div className="border-b border-[#e7e9ee]">
      <div className="flex items-center gap-1">
        {tabs.map(([tab, label]) => {
          const active =
            activeTab === tab;

          return (
            <button
              key={tab}
              type="button"
              onClick={() => onChange(tab)}
              className={[
                "relative shrink-0 cursor-pointer px-4 py-3",
                "text-[13px] font-semibold transition-colors",
                active
                  ? "text-[#172033]"
                  : "text-[#687182] hover:text-[#172033]",
              ].join(" ")}
            >
              {label}

              {active && (
                <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#315c9f]" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}