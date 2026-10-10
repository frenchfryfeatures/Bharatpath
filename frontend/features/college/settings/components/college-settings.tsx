"use client";

import { usePageHeader } from "@/components/layout/header-context";

import { useSettings } from "../hooks/use-settings";

import { Billing } from "./billing";
import { CollegeOnboarding } from "./college-onboarding";
import { CollegeProfile } from "./college-profile";
import { seatStat } from "../../seat-stat";
import { CollegeUsers } from "./college-users";
import { AccountSecurityCard } from "@/components/auth/account-security-card";

const tabs = [
  {
    id: "profile" as const,
    label: "College profile",
  },
  {
    id: "users" as const,
    label: "Users",
  },
  {
    id: "billing" as const,
    label: "Seats & payment",
  },
  {
    id: "onboarding" as const,
    label: "Onboarding",
  },
];

export function CollegeSettings() {
  const {
    activeTab,
    changeTab,
    seats,
    isLoadingSeats,
  } = useSettings("header");

  usePageHeader(
    "Settings & Billing",
    "College profile, users, seats and payment",
    { stat: seatStat(seats, isLoadingSeats) },
  );

  return (
    <div
      className="min-h-full bg-[#f8f9fb]"
      style={{ fontFamily: "'General Sans', sans-serif" }}
    >
      {/* Settings Tabs */}
      <div className="border-b border-[#e1e5eb] bg-[#f8f9fb]">
        <div className="flex h-[49px] items-end">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => changeTab(tab.id)}
                className={[
                  "relative flex h-[49px] items-center px-4",
                  "whitespace-nowrap text-[13px] font-semibold",
                  "transition-colors",
                  active
                    ? "text-[#131A26]"
                    : "text-[#64748b] hover:text-[#131A26]",
                ].join(" ")}
              >
                {tab.label}

                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#3566b8]" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Settings Content */}
      <main className="min-h-[calc(100vh-125px)] pt-5">
        {activeTab === "profile" && (
          <>
            <CollegeProfile />
            <div className="mt-4">
              <AccountSecurityCard />
            </div>
          </>
        )}

        {activeTab === "users" && (
          <CollegeUsers />
        )}

        {activeTab === "billing" && (
          <Billing />
        )}

        {activeTab === "onboarding" && (
          <CollegeOnboarding />
        )}
      </main>
    </div>
  );
}