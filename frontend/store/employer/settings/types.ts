export type SettingsTab =
  | "company"
  | "team"
  | "payment"
  | "subscription"
  | "invoices";

export type TeamRole = "Owner" | "Recruiter" | "View only";
export type TeamStatus = "Active" | "Invited";

export interface CompanyProfile {
  legalName: string;
  gstin: string;
  businessType: string;
  industry: string;
  kybStatus: string;
  address: string;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  status: TeamStatus;
  canRemove: boolean;
}

export interface PaymentMethod {
  id: string;
  type: "UPI";
  label: string;
  value: string;
  isDefault: boolean;
  status: "Verified" | "Pending";
}

export interface CreditPack {
  id: string;
  credits: number;
  price: number;
  perUnit: number;
  popular?: boolean;
}

export interface Invoice {
  id: string;
  description: string;
  date: string;
  amount: number;
  status: "Paid" | "Pending" | "Failed";
}

export interface AccountProfile {
  fullName: string;
  phone: string;
  workEmail: string;
  twoFactorEnabled: boolean;
}

export interface EmployerSettingsState {
  activeTab: SettingsTab;
  company: CompanyProfile;
  team: TeamMember[];
  paymentMethods: PaymentMethod[];
  creditBalance: number;
  creditPacks: CreditPack[];
  selectedCreditPackId: string | null;
  invoices: Invoice[];
  account: AccountProfile;
  inviteModalOpen: boolean;
  paymentModalOpen: boolean;
  checkoutModalOpen: boolean;
  memberMenuOpenId: string | null;
  removeMemberId: string | null;
  toast: string | null;
}
