import type { RootState } from "@/store";

export const selectEmployerSettings = (state: RootState) =>
  state.employerSettings;

export const selectSettingsTab = (state: RootState) =>
  state.employerSettings.activeTab;

export const selectCompanyProfile = (state: RootState) =>
  state.employerSettings.company;

export const selectTeamMembers = (state: RootState) =>
  state.employerSettings.team;

export const selectPaymentMethods = (state: RootState) =>
  state.employerSettings.paymentMethods;

export const selectEmployerCreditBalance = (state: RootState) =>
  state.employerSettings.creditBalance;

export const selectEmployerCreditPacks = (state: RootState) =>
  state.employerSettings.creditPacks;

export const selectSelectedCreditPack = (state: RootState) =>
  state.employerSettings.creditPacks.find(
    (pack) => pack.id === state.employerSettings.selectedCreditPackId,
  ) ?? null;

export const selectInvoices = (state: RootState) =>
  state.employerSettings.invoices;


export const selectTotalSpent = (state: RootState) =>
  state.employerSettings.invoices.reduce(
    (total, invoice) => total + invoice.amount,
    0,
  );

export const selectHasUnsavedChanges = (state: RootState) =>
  state.employerSettings.hasUnsavedChanges;

export const selectPendingTab = (state: RootState) =>
  state.employerSettings.pendingTab;
