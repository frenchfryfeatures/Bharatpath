"use client";

import { usePageHeader } from "@/components/layout/header-context";

import { useSettings } from "../hooks/use-settings";

import { ErrorState } from "@/components/ui";

import { SettingsTabs } from "./settings-tabs";
import { KybApprovalTab } from "./kyb-approval-tab";
import { ProfilePhotoCard } from "@/components/profile-image/profile-photo-card";
import { AccountSecurityCard } from "@/components/auth/account-security-card";

export function SettingsPage() {
  usePageHeader(
    "Settings",
    "KYB approval mode, your profile photo and account security",
  );

  const {
    state,
    isLoading,
    error,
    isSaving,
    saveError,
    canChangeKybMode,
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
          canChange={canChangeKybMode}
          saveError={Boolean(saveError)}
          onModeChange={setKybMode}
        />
      ) : (
        <div className="mt-4 flex max-w-[640px] flex-col gap-4">
          <ProfilePhotoCard />
          <AccountSecurityCard />
        </div>
      )}
    </div>
  );
}

export const AdminSettingsPage =
  SettingsPage;
