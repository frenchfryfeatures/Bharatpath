"use client";

import { useEffect } from "react";
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
import { TeamTab } from "./team-tab";
import { PaymentTab } from "./payment-tab";
import { SubscriptionTab } from "./subscription-tab";
import { InvoicesTab } from "./invoices-tab";
import { AccountTab } from "./account-tab";
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
        return <CompanyTab />;
      case "team":
        return <TeamTab />;
      case "payment":
        return <PaymentTab />;
      case "subscription":
        return <SubscriptionTab />;
      case "invoices":
        return <InvoicesTab />;
      case "account":
        return <AccountTab />;
      default:
        return <CompanyTab />;
    }
  };

  return (
    <div className="min-h-full bg-[#f7f8fa] font-sans text-[#111827]">
      <SettingsTabs />

      <main className="w-full max-w-[1000px] pt-4">
        {renderTab()}
      </main>

      {settings.inviteModalOpen && <InviteMemberModal />}
      {settings.paymentModalOpen && <AddPaymentMethodModal />}
      {settings.checkoutModalOpen && <BuyCreditsModal />}

      {settings.removeMemberId && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-900/35 p-5">
          <div className="w-full max-w-[440px] rounded-[13px] border border-[#dfe4ea] bg-white p-5 shadow-[0_20px_50px_rgba(15,23,42,0.18)]">
            <h3 className="m-0 text-[15px] font-bold">
              Remove team member?
            </h3>

            <p className="mt-2 text-xs leading-[18px] text-[#718096]">
              This member will immediately lose access to the employer account.
            </p>

            <div className="mt-[18px] flex justify-end gap-2">
              <button
                type="button"
                className="min-h-9 cursor-pointer rounded-lg border border-[#d6dbe2] bg-white px-3.5 text-xs font-bold text-[#172033]"
                onClick={() => dispatch(cancelRemoveMember())}
              >
                Cancel
              </button>

              <button
                type="button"
                className="min-h-9 cursor-pointer rounded-lg border border-[#c0392b] bg-[#c0392b] px-3.5 text-xs font-bold text-white"
                disabled={isRemoving}
                onClick={() => {
                  if (!settings.removeMemberId) return;
                  void removeMember(settings.removeMemberId).unwrap().then(() => dispatch(confirmRemoveMember())).catch(() => undefined);
                }}
              >
                Remove member
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
