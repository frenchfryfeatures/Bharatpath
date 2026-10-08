"use client";

import { useState } from "react";

// import { QueueStatusBanner } from "@/components/banner"; // kept for later use
import { DemoStatePanel } from "@/components/demo-state";
import { PortalShell } from "@/components/layout/portal-shell";
import { PortalAccessGuard } from "@/components/auth/portal-access-guard";

type EmployerState =
  | "not-started"
  | "pending"
  | "info-requested"
  | "approved";

export default function EmployerLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [demoPanelOpen, setDemoPanelOpen] = useState(false);
  const [employerState, setEmployerState] =
    useState<EmployerState>("pending");

  // Banner temporarily hidden - kept for later use.
  // const [bannerDismissed, setBannerDismissed] = useState(false);
  //
  // let banner = {
  //   title: "Verification in progress",
  //   message:
  //     "Usually 1 to 2 business days. You can draft jobs and browse candidates while you wait.",
  // };
  //
  // if (employerState === "approved") {
  //   banner = {
  //     title: "Verification approved",
  //     message:
  //       "Your company is verified. You can publish jobs and unlock candidates.",
  //   };
  // } else if (employerState === "info-requested") {
  //   banner = {
  //     title: "Information requested",
  //     message:
  //       "Submit the requested company information to continue verification.",
  //   };
  // } else if (employerState === "not-started") {
  //   banner = {
  //     title: "Verification not started",
  //     message:
  //       "Usually 1 to 2 business days. You can draft jobs and browse candidates while you wait.",
  //   };
  // }

  const updateState = (value: EmployerState) => {
    setEmployerState(value);
    // setBannerDismissed(false);
    setDemoPanelOpen(false);
  };

  return (
    <PortalAccessGuard portal="employer">
      <div className="flex h-screen flex-col overflow-hidden">
      {/* Temporarily hidden - kept for later use.
      {!bannerDismissed && (
        <QueueStatusBanner
          variant={employerState === "approved" ? "success" : "progress"}
          title={banner.title}
          message={banner.message}
          onDismiss={() => setBannerDismissed(true)}
        />
      )} */}

      <div className="min-h-0 flex-1 overflow-hidden">
        <PortalShell
          portal="employer"
          demoPanel={
            demoPanelOpen ? (
              <DemoStatePanel
                label="KYB"
                options={[
                  { id: "not-started", label: "Not started", active: employerState === "not-started", onClick: () => updateState("not-started") },
                  { id: "pending", label: "Pending", active: employerState === "pending", onClick: () => updateState("pending") },
                  { id: "info-requested", label: "Info requested", active: employerState === "info-requested", onClick: () => updateState("info-requested") },
                  { id: "approved", label: "Approved", active: employerState === "approved", onClick: () => updateState("approved") },
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
