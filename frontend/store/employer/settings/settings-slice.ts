import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type {
  EmployerSettingsState,
  SettingsTab,
  TeamMember,
  TeamRole,
} from "./types";

const initialState: EmployerSettingsState = {
  activeTab: "company",

  company: {
    legalName: "",
    businessType: "",
    industry: "",
    kybStatus: "",
    pan: "",
    gstin: "",
    cin: "",
    tan: "",
    address: "",
    addressLine1: "",
    addressLine2: "",
    city: "",
    state: "",
    pincode: "",
    signatoryName: "",
    signatoryDesignation: "",
    workEmail: "",
    workPhone: "",
    documents: [],
    undertakings: {
      genuineHiring: true,
      noRedistribution: true,
      authorised: true,
      submittedAt: null,
    },
    tradeName: "",
    employeeCountBand: "",
    website: "",
    about: "",
    hasSeparateCorrespondenceAddress: false,
    correspondenceAddress: "",
  },

  // Team membership is loaded from GET /employer/team when the Team tab opens.
  team: [],

  paymentMethods: [
    {
      id: "pm1",
      type: "UPI",
      label: "UPI · sterling@upi",
      value: "sterling@upi",
      isDefault: true,
      status: "Verified",
    },
  ],

  creditBalance: 8,

  creditPacks: [
    { id: "p1", credits: 10, price: 999, perUnit: 99.9 },
    { id: "p2", credits: 50, price: 3999, perUnit: 80, popular: true },
    { id: "p3", credits: 150, price: 9999, perUnit: 66.7 },
  ],

  selectedCreditPackId: "p2",

  invoices: [
    {
      id: "i1",
      description: "50-credit pack",
      date: "12 Aug 2026",
      amount: 3999,
      status: "Paid",
    },
    {
      id: "i2",
      description: "10-credit pack",
      date: "2 Jul 2026",
      amount: 999,
      status: "Paid",
    },
  ],

  inviteModalOpen: false,
  paymentModalOpen: false,
  checkoutModalOpen: false,
  memberMenuOpenId: null,
  removeMemberId: null,
  toast: null,
  hasUnsavedChanges: false,
  pendingTab: null,
};

const settingsSlice = createSlice({
  name: "employerSettings",
  initialState,
  reducers: {
    replaceCompanyProfile(
      state,
      action: PayloadAction<EmployerSettingsState["company"]>,
    ) {
      state.company = action.payload;
    },

    replaceTeamMembers(
      state,
      action: PayloadAction<TeamMember[]>,
    ) {
      state.team = action.payload;
    },

    setActiveTab(state, action: PayloadAction<SettingsTab>) {
      state.activeTab = action.payload;
    },

    updateCompanyField(
      state,
      action: PayloadAction<{
        field: keyof EmployerSettingsState["company"];
        value: any;
      }>,
    ) {
      (state.company as Record<string, any>)[action.payload.field] =
        action.payload.value;
    },

    saveCompanyProfile(state) {
      state.toast = "Company profile saved.";
    },

    openInviteModal(state) {
      state.inviteModalOpen = true;
    },

    closeInviteModal(state) {
      state.inviteModalOpen = false;
    },

    inviteMember(
      state,
      action: PayloadAction<{ email: string; role: TeamRole }>,
    ) {
      const { email, role } = action.payload;
      const localName = email.split("@")[0] || "New member";
      const name = localName
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());

      state.team.push({
        id: `t${Date.now()}`,
        name,
        email,
        role,
        status: "Invited",
        canRemove: true,
      });

      state.inviteModalOpen = false;
      state.toast = "Invite sent.";
    },

    toggleMemberMenu(state, action: PayloadAction<string>) {
      state.memberMenuOpenId =
        state.memberMenuOpenId === action.payload ? null : action.payload;
    },

    closeMemberMenu(state) {
      state.memberMenuOpenId = null;
    },

    askRemoveMember(state, action: PayloadAction<string>) {
      state.memberMenuOpenId = null;
      state.removeMemberId = action.payload;
    },

    cancelRemoveMember(state) {
      state.removeMemberId = null;
    },

    confirmRemoveMember(state) {
      if (state.removeMemberId) {
        state.team = state.team.filter(
          (member) => member.id !== state.removeMemberId,
        );
      }
      state.removeMemberId = null;
      state.toast = "Team member removed.";
    },

    resendInvite(state, action: PayloadAction<string>) {
      state.memberMenuOpenId = null;
      state.toast = "Invite resent.";
    },

    openPaymentModal(state) {
      state.paymentModalOpen = true;
    },

    closePaymentModal(state) {
      state.paymentModalOpen = false;
    },

    addPaymentMethod(
      state,
      action: PayloadAction<{ upiId: string }>,
    ) {
      const upiId = action.payload.upiId.trim();
      if (!upiId) return;

      state.paymentMethods = state.paymentMethods.map((method) => ({
        ...method,
        isDefault: false,
      }));

      state.paymentMethods.unshift({
        id: `pm${Date.now()}`,
        type: "UPI",
        label: `UPI · ${upiId}`,
        value: upiId,
        isDefault: true,
        status: "Verified",
      });

      state.paymentModalOpen = false;
      state.toast = "Payment method added.";
    },

    setSelectedCreditPack(state, action: PayloadAction<string>) {
      state.selectedCreditPackId = action.payload;
    },

    openCheckoutModal(state) {
      state.checkoutModalOpen = true;
    },

    closeCheckoutModal(state) {
      state.checkoutModalOpen = false;
    },

    completeCreditPurchase(state) {
      const pack = state.creditPacks.find(
        (item) => item.id === state.selectedCreditPackId,
      );

      if (!pack) return;

      state.creditBalance += pack.credits;

      state.invoices.unshift({
        id: `i${Date.now()}`,
        description: `${pack.credits}-credit pack`,
        date: new Intl.DateTimeFormat("en-GB", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date()),
        amount: pack.price,
        status: "Paid",
      });

      state.checkoutModalOpen = false;
      state.toast = `${pack.credits} credits added.`;
    },

    clearToast(state) {
      state.toast = null;
    },

    setHasUnsavedChanges(state, action: PayloadAction<boolean>) {
      state.hasUnsavedChanges = action.payload;
    },

    setPendingTab(state, action: PayloadAction<SettingsTab | null>) {
      state.pendingTab = action.payload;
    },

    clearPendingTab(state) {
      state.pendingTab = null;
    },
  },
});

export const {
  replaceCompanyProfile,
  replaceTeamMembers,
  setActiveTab,
  updateCompanyField,
  saveCompanyProfile,
  openInviteModal,
  closeInviteModal,
  inviteMember,
  toggleMemberMenu,
  closeMemberMenu,
  askRemoveMember,
  cancelRemoveMember,
  confirmRemoveMember,
  resendInvite,
  openPaymentModal,
  closePaymentModal,
  addPaymentMethod,
  setSelectedCreditPack,
  openCheckoutModal,
  closeCheckoutModal,
  completeCreditPurchase,
  clearToast,
  setHasUnsavedChanges,
  setPendingTab,
  clearPendingTab,
} = settingsSlice.actions;

export default settingsSlice.reducer;
