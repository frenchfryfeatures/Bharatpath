"use client";

import { useEffect } from "react";
import { ConfirmModal } from "@/components/ui";
import { usePageHeader } from "@/components/layout/header-context";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  cancelRemoveMember,
  clearToast,
  confirmRemoveMember,
  selectEmployerSettings,
  useRemoveEmployerTeamMemberMutation,
} from "@/store/employer/settings";

import { SettingsTabs } from "./settings-tabs";
import { CompanyTab } from "./company-tab";
import { EmployerLogoCard } from "./employer-logo-card";
import { TeamTab } from "./team-tab";
import { PaymentTab } from "./payment-tab";
import { SubscriptionTab } from "./subscription-tab";
import { InvoicesTab } from "./invoices-tab";
import { InviteMemberModal } from "./invite-member-modal";
import { AddPaymentMethodModal } from "./add-payment-method-modal";
import { BuyCreditsModal } from "./buy-credits-modal";

export function EmployerSettingsPage() {
  const dispatch = useAppDispatch();
  const settings = useAppSelector(selectEmployerSettings);
  const [removeMember, { isLoading: isRemoving }] = useRemoveEmployerTeamMemberMutation();

  usePageHeader(
    "Settings & Billing",
    "Company profile, team access, billing and account security"
  );

  useEffect(() => {
    if (!settings.toast) return;

    showSuccessFeedback(settings.toast);
    dispatch(clearToast());
  }, [dispatch, settings.toast]);

  const renderTab = () => {
    switch (settings.activeTab) {
      case "company":
        return (
          <>
            <EmployerLogoCard />
            <CompanyTab />
          </>
        );
      case "team":
        return <TeamTab />;
      case "payment":
        return <PaymentTab />;
      case "subscription":
        return <SubscriptionTab />;
      case "invoices":
        return <InvoicesTab />;
      default:
        return <CompanyTab />;
    }
  };

  return (
    <div className="min-h-full bg-[#f7f8fa] font-sans text-[#111827]">
      <SettingsTabs />

      <main className="w-full pt-4">
        {renderTab()}
      </main>

      {settings.inviteModalOpen && <InviteMemberModal />}
      {settings.paymentModalOpen && <AddPaymentMethodModal />}
      {settings.checkoutModalOpen && <BuyCreditsModal />}

      <ConfirmModal
        open={Boolean(settings.removeMemberId)}
        title="Remove team member?"
        description="This member will immediately lose access to the employer account."
        confirmLabel="Remove member"
        tone="danger"
        confirmLoading={isRemoving}
        onClose={() => dispatch(cancelRemoveMember())}
        onConfirm={() => {
          if (!settings.removeMemberId) return;
          void removeMember(settings.removeMemberId)
            .unwrap()
            .then(() => dispatch(confirmRemoveMember()))
            .catch(() => undefined);
        }}
      />
    </div>
  );
}
