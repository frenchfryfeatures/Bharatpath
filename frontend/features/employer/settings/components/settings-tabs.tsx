"use client";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectSettingsTab,
  setActiveTab,
  type SettingsTab,
} from "@/store/employer/settings";

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "company", label: "Company" },
  { id: "team", label: "Team" },
  { id: "payment", label: "Payment methods" },
  { id: "subscription", label: "Subscription" },
  { id: "invoices", label: "Invoices" },
];

export function SettingsTabs() {
  const dispatch = useAppDispatch();
  const active = useAppSelector(selectSettingsTab);

  return (
    <nav
      aria-label="Settings"
      className="flex h-11 gap-0 overflow-x-auto border-b border-[#e6e9ee]"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => dispatch(setActiveTab(tab.id))}
          className={[
            "h-full shrink-0 border-0 border-b-2 bg-transparent px-3.5 text-[13px] font-semibold",
            "cursor-pointer whitespace-nowrap",
            active === tab.id
              ? "border-b-[#4f67c8] text-[#111827]"
              : "border-b-transparent text-[#566171]",
          ].join(" ")}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
