"use client";

import { usePageHeader } from "@/components/layout/header-context";

import { useSettings } from "../hooks/use-settings";

import { ErrorState } from "@/components/ui";

import { SettingsTabs } from "./settings-tabs";
import { KybApprovalTab } from "./kyb-approval-tab";
import { PlatformTab } from "./platform-tab";
import { AccountSecurityCard } from "@/components/auth/account-security-card";

export function SettingsPage() {
  usePageHeader(
    "Settings",
    "Approval mode, verification checks and platform controls",
  );

  const {
    state,
    isLoading,
    error,
    isSaving,
    saveError,
    setKybMode,
    setTab,
  } = useSettings();

  return (
    <div className="min-w-0">
      <SettingsTabs
        activeTab={state.tab}
        onChange={setTab}
      />

      {error ? <ErrorState error={error} fallback="Could not read the current KYB mode." className="mt-4" /> : null}

      {state.tab === "approval" ? (
        <KybApprovalTab
          kybMode={state.kybMode}
          isLoading={isLoading}
          hasError={Boolean(error)}
          isSaving={isSaving}
          saveError={Boolean(saveError)}
          onModeChange={setKybMode}
        />
      ) : (
        <>
          <PlatformTab />
          <div className="mt-4">
            <AccountSecurityCard />
          </div>
        </>
      )}
    </div>
  );
}

export const AdminSettingsPage =
  SettingsPage;
