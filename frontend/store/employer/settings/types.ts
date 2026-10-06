export type SettingsTab =
  | "company"
  | "team"
  | "payment"
  | "subscription"
  | "invoices";

export type TeamRole = "Owner" | "Recruiter" | "View only";
export type TeamStatus = "Active" | "Invited";

export interface CompanyDocumentItem {
  docType: string;
  mime: string | null;
  uploadedAt: string;
}

export interface CompanyUndertakings {
  genuineHiring: boolean;
  noRedistribution: boolean;
  authorised: boolean;
  submittedAt?: string | null;
}

export interface CompanyProfile {
  // Read-only / locked
  legalName: string;
  businessType: string;
  industry: string;
  kybStatus: string;
  pan: string;
  gstin: string;
  cin: string;
  tan: string;
  address: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  signatoryName: string;
  signatoryDesignation: string;
  workEmail: string;
  workPhone: string;
  documents: CompanyDocumentItem[];
  undertakings: CompanyUndertakings;

  // Editable directly
  tradeName: string;
  employeeCountBand: string;
  website: string;
  about: string;
  hasSeparateCorrespondenceAddress: boolean;
  correspondenceAddress: string;
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

export interface EmployerSettingsState {
  activeTab: SettingsTab;
  company: CompanyProfile;
  team: TeamMember[];
  paymentMethods: PaymentMethod[];
  creditBalance: number;
  creditPacks: CreditPack[];
  selectedCreditPackId: string | null;
  invoices: Invoice[];
  inviteModalOpen: boolean;
  paymentModalOpen: boolean;
  checkoutModalOpen: boolean;
  memberMenuOpenId: string | null;
  removeMemberId: string | null;
  toast: string | null;
  hasUnsavedChanges: boolean;
  pendingTab: SettingsTab | null;
}
