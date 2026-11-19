import type {
  CollegeOrganisation,
  CollegeSeats,
  CollegeTeamMember,
} from "@/store/college/types";

export type SettingsTab =
  | "profile"
  | "users"
  | "billing"
  | "onboarding";

export type UserRole = "Admin" | "Staff";

export type CollegeProfile =
  CollegeOrganisation;

export interface CollegeUser extends CollegeTeamMember {
  initials: string;
  displayName: string;
  roleLabel: UserRole;
}

export interface CollegeSettingsState {
  activeTab: SettingsTab;
  profile: CollegeProfile | null;
  users: CollegeUser[];
  seats: CollegeSeats | null;
  isSavingProfile: boolean;
  isInvitingUser: boolean;
  isRemovingUser: boolean;
  saveProfileError: string | null;
  inviteUserError: string | null;
}

export const INSTITUTION_TYPE_OPTIONS: {
  code: string;
  label: string;
}[] = [
  { code: "UNIVERSITY", label: "University" },
  { code: "DEEMED_UNIVERSITY", label: "Deemed university" },
  { code: "AUTONOMOUS_COLLEGE", label: "Autonomous college" },
  { code: "AFFILIATED_COLLEGE", label: "Affiliated college" },
  { code: "ENGINEERING_COLLEGE", label: "Engineering college" },
  { code: "MANAGEMENT_INSTITUTE", label: "Management institute" },
  { code: "POLYTECHNIC", label: "Polytechnic" },
  { code: "ITI", label: "Industrial Training Institute" },
  { code: "TRAINING_INSTITUTE", label: "Private training institute" },
  { code: "OTHER", label: "Other" },
];