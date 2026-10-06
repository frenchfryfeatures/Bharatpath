/*
 * College portal domain types.
 *
 * snake_case API payloads are mapped into these camelCase UI shapes at the
 * API layer (`store/college/*.api.ts`). Slices and components read only
 * these types; nothing outside the API layer sees a raw backend field.
 */

/* =========================================================
   Organisation & team
========================================================= */

export type CollegeTeamRole =
  | "COLLEGE_ADMIN"
  | "COLLEGE_STAFF";

export interface CollegeOrganisation {
  tenantId: string;
  name: string;
  institutionType: string | null;
  onboardingSubmittedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
}

export interface CollegeTeamMember {
  userId: string;
  email: string;
  role: CollegeTeamRole;
  addedAt: string;
}

/*
 * The onboarding form is data-driven: the backend publishes the field list and
 * the client renders it. Field keys stay snake_case because the `form` object
 * is passed through untouched from the API (it is a published definition, not a
 * mapped domain object).
 */
export type OnboardingFieldType =
  | "TEXT"
  | "TEXTAREA"
  | "EMAIL"
  | "PHONE"
  | "NUMBER"
  | "SELECT"
  | "MULTISELECT"
  | "DATE"
  | "FILE"
  | "CHECKBOX";

export interface OnboardingField {
  code: string;
  key: string;
  label: string;
  type: OnboardingFieldType;
  required: boolean;
  pattern: string | null;
  max_length: number | null;
  help_text: string | null;
  options_source: string | null;
  public: boolean;
  verification_note: string | null;
}

export interface OnboardingSection {
  code: string;
  title: string;
  fields: OnboardingField[];
  help_text: string | null;
}

export interface OnboardingFormDefinition {
  code: string;
  version: string;
  sections: OnboardingSection[];
}

export interface OnboardingOption {
  code: string;
  label: string;
}

export interface CollegeOnboarding {
  form: OnboardingFormDefinition;
  options: Record<string, OnboardingOption[]>;
  answers: Record<string, unknown>;
  formVersion: string | null;
  submittedAt: string | null;
}

/* =========================================================
   Seats
========================================================= */

export interface CollegeSeats {
  allocated: number;
  used: number;
  available: number;
  subscriptionActive: boolean;
}

/* =========================================================
   Subscription & billing
========================================================= */

export type SubscriptionState =
  | "NONE"
  | "PENDING"
  | "ACTIVE"
  | "GRACE"
  | "LAPSED"
  | "CANCELLED";

export type PaymentStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "REFUNDED";

export type PlanPeriod =
  | "MONTHLY"
  | "QUARTERLY"
  | "SEMESTER"
  | "SEMI_ANNUAL"
  | "ANNUAL";

export interface CollegePlan {
  code: string;
  audience: "CANDIDATE" | "EMPLOYER" | "COLLEGE";
  period: PlanPeriod;
  months: number;
  priceMinor: number;
  currency: string;
  seatAllowance: number | null;
}

export interface CollegeSubscription {
  state: SubscriptionState;
  hasAccess: boolean;
  planCode: string | null;
  period: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  renewsAutomatically: boolean;
  mandateState: string | null;
}

export interface CheckoutResult {
  paymentId: string;
  status: string;
  amountMinor: number;
  currency: string;
  redirectUrl: string | null;
}

export interface MandateResult {
  state: string;
  maxAmountMinor: number;
  validUntil: string | null;
  authorisationUrl: string;
}

export interface Payment {
  id: string;
  status: PaymentStatus;
  purpose: string;
  itemCode: string;
  amountMinor: number;
  currency: string;
  failureCode: string | null;
  createdAt: string;
  settledAt: string | null;
}

/* =========================================================
   Analytics
========================================================= */

/** A band is `null` when it is withheld: too few students to show safely. */
export interface ScoreDistribution {
  entry: number | null;
  developing: number | null;
  solid: number | null;
  strong: number | null;
}

export interface CohortOverview {
  connectedStudents: number;
  individuallyVisible: number;
  minCohortSize: number;
  belowFloor: boolean;
  /* Every figure below is `null` under the cohort privacy floor. */
  scoredStudents: number | null;
  scoreDistribution: ScoreDistribution | null;
  medianScore: number | null;
  applicants: number | null;
  applications: number | null;
  interviews: number | null;
  platformHires: number | null;
}

export interface MonthHires {
  month: string;
  hires: number | null;
}

export interface LocationHires {
  location: string;
  hires: number;
}

export interface PlacementReport {
  source: "PLATFORM";
  minCohortSize: number;
  belowFloor: boolean;
  totalHires: number | null;
  byMonth: MonthHires[];
  byLocation: LocationHires[];
}

/**
 * `GET /college/analytics/applications`: where the cohort's applications
 * stand, and how many ever reached each milestone. Aggregate only - no
 * student is named - and a `null` figure is withheld by the privacy floors,
 * never a zero.
 */
export interface ApplicationFunnel {
  minCohortSize: number;
  belowFloor: boolean;
  totalApplications: number | null;
  byStage: Record<string, number | null>;
  reached: Record<string, number | null>;
}