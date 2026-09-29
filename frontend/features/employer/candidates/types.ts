export type CandidateBand = "ENTRY" | "DEVELOPING" | "SOLID" | "STRONG";
export type CandidateBadge = "COURSE_COMPLETED" | "MOCK_INTERVIEW_COMPLETED";

export interface Candidate {
  candidateId: string;
  band: CandidateBand;
  location: string;
  experienceYears: number;
  skills: string[];
  badges: CandidateBadge[];
  // Populated from the reveal when masking is off.
  fullName?: string | null;
  phone?: string | null;
  email?: string | null;
  score?: number | null;
}

export interface CandidateFiltersState {
  search: string;
  bands: CandidateBand[];
  skills: string[];
  locations: string[];
  state: string;
  experiences: string[];
  addons: CandidateBadge[];
}
