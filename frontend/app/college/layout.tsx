"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { PortalShell } from "@/components/layout/portal-shell";
import { PortalAccessGuard } from "@/components/auth/portal-access-guard";
// import { QueueStatusBanner } from "@/components/banner"; // kept for later use
import { DemoStatePanel } from "@/components/demo-state";

type CollegeState = "pending" | "active" | "exhausted";

export default function CollegeLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [demoPanelOpen, setDemoPanelOpen] = useState(false);
  const [collegeState, setCollegeState] =
    useState<CollegeState>("pending");

  const isPending = collegeState === "pending";

  // Banner temporarily hidden - kept for later use.
  // const [bannerDismissed, setBannerDismissed] = useState(false);
  //
  // let banner = {
  //   title: "Seats exhausted",
  //   message:
  //     "Add more seats to invite students and continue using analytics.",
  // };
  //
  // if (isPending) {
  //   banner = {
  //     title: "Payment pending",
  //     message:
  //       "Student invites and analytics unlock once your seat payment clears. You can explore the portal meanwhile.",
  //   };
  // } else if (collegeState === "active") {
  //   banner = {
  //     title: "Payment active",
  //     message:
  //       "Student invites and analytics are available for your active seat plan.",
  //   };
  // }

  const updateState = (value: CollegeState) => {
    setCollegeState(value);
    // setBannerDismissed(false);
    setDemoPanelOpen(false);
  };

  return (
    <PortalAccessGuard portal="college">
      <div className="flex h-screen flex-col overflow-hidden">
      {/* Temporarily hidden - kept for later use.
      {!bannerDismissed && (
        <QueueStatusBanner
          variant={isPending ? "pending" : "progress"}
          title={banner.title}
          message={banner.message}
          onDismiss={() => setBannerDismissed(true)}
        />
      )} */}

      <div className="min-h-0 flex-1 overflow-hidden">
        <PortalShell
          portal="college"
          demoPanel={
            demoPanelOpen ? (
              <DemoStatePanel
                label="Payment & seats"
                options={[
                  { id: "pending", label: "Payment pending", active: isPending, onClick: () => updateState("pending") },
                  { id: "active", label: "Active", active: collegeState === "active", onClick: () => updateState("active") },
                  { id: "exhausted", label: "Seats exhausted", active: collegeState === "exhausted", onClick: () => updateState("exhausted") },
                ]}
              />
            ) : null
          }
          onDemoStateClick={() => setDemoPanelOpen((value) => !value)}
        >
          {children}
        </PortalShell>
      </div>
      </div>
    </PortalAccessGuard>
  );
}
