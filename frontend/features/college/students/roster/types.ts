/*
 * LINKED rows use names the student allowed the college to see. Earlier
 * stages use only names from the college's own uploaded roster. Score, band
 * and activity counts remain available only when opening a LINKED student.
 */

export type StudentStatus =
  | "linked"
  | "invited"
  | "consent_pending";

export type ScoreBand =
  | "building"
  | "strong"
  | "exceptional"
  | "not_scored";

/* A row in the college roster, before or after individual visibility. */
export interface CollegeStudent {
  id: string;
  candidateId: string | null;
  name: string;
  status: StudentStatus;
  stageSince: string;
  visibleSince: string | null;
  scoreBand?: ScoreBand;
  score?: number | null;
}

export interface StudentHire {
  jobTitle: string;
  employerName: string;
  hiredAt: string;
  source: "PLATFORM";
}

/* A single student opened from the roster. */
export interface CollegeStudentDetail extends CollegeStudent {
  scoredAt: string | null;
  applications: number;
  interviews: number;
  hires: StudentHire[];
}

export interface StudentFilters {
  search?: string;
  status?: StudentStatus | "all";
}