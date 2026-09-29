export type StudentScoreBand =
  | "ENTRY"
  | "DEVELOPING"
  | "SOLID"
  | "STRONG";

export type CollegeStudentLinkState =
  | "LINKED"
  | "INVITED"
  | "CONSENT_PENDING";

export type CollegeStudentStageFilter =
  | "ALL"
  | CollegeStudentLinkState;

export interface VisibleStudent {
  candidateId: string | null;
  rosterEntryId: string | null;
  fullName: string | null;
  stageSince: string;
  visibleSince: string | null;
  linkState: CollegeStudentLinkState;
}

export interface VisibleStudentsPage {
  items: VisibleStudent[];
  nextCursor: string | null;
}

export interface StudentHire {
  jobTitle: string;
  employerName: string;
  hiredAt: string;
  source: "PLATFORM";
}

export interface CollegeStudentDetail {
  candidateId: string;
  fullName: string | null;
  visibleSince: string;
  score: number | null;
  band: StudentScoreBand | null;
  scoredAt: string | null;
  applications: number;
  interviews: number;
  hires: StudentHire[];
}
