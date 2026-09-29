import type { ApplicationStage } from "./types";

export interface CandidateSkillProfile {
  id: string;
  name: string;
  skills: string[];
  unlocked: boolean;
}

export interface JobSkillProfile {
  id: string;
  title: string;
  skills: string[];
}

export interface StageDefinition {
  value: ApplicationStage;
  label: string;
}

/*
 * Reference data backing the application drawer's skill match.
 * These mirror the BharatPath Employer Portal seed data.
 */
export const CANDIDATE_SKILL_PROFILES: CandidateSkillProfile[] = [
  {
    id: "c1",
    name: "S. Deshmukh",
    skills: [
      "Quality inspection",
      "MS Excel",
      "Basic English",
      "Documentation",
      "Attention to detail",
      "Batch testing",
    ],
    unlocked: true,
  },
  {
    id: "c2",
    name: "A. Kulkarni",
    skills: [
      "Team supervision",
      "Safety compliance",
      "Shift planning",
      "Basic English",
      "Inventory mgmt",
      "MS Excel",
    ],
    unlocked: false,
  },
  {
    id: "c3",
    name: "R. Patil",
    skills: [
      "Quality inspection",
      "Forklift certified",
      "Inventory mgmt",
      "Team supervision",
      "Safety compliance",
      "Warehouse ops",
      "MS Excel",
    ],
    unlocked: false,
  },
  {
    id: "c4",
    name: "M. Shaikh",
    skills: [
      "Packaging",
      "Basic English",
    ],
    unlocked: false,
  },
  {
    id: "c5",
    name: "V. Joshi",
    skills: [
      "Machine operation",
      "Hindi typing",
      "Safety compliance",
      "Basic English",
      "Inventory mgmt",
    ],
    unlocked: false,
  },
  {
    id: "c6",
    name: "N. Gaikwad",
    skills: [
      "MS Excel",
      "Customer service",
      "Team supervision",
      "Basic English",
      "Shift planning",
      "Documentation",
    ],
    unlocked: false,
  },
];

export const JOB_SKILL_PROFILES: JobSkillProfile[] = [
  {
    id: "j1",
    title: "Lab Analyst Trainee",
    skills: [
      "Quality inspection",
      "MS Excel",
    ],
  },
  {
    id: "j2",
    title: "Quality Control Trainee",
    skills: [
      "Quality inspection",
      "Safety compliance",
    ],
  },
  {
    id: "j4",
    title: "Packaging Operator",
    skills: [
      "Packaging",
    ],
  },
];

export const APPLICATION_STAGES: StageDefinition[] = [
  { value: 0, label: "Submitted" },
  { value: 1, label: "Viewed" },
  { value: 2, label: "Shortlisted" },
  { value: 3, label: "Interview" },
  { value: 4, label: "Decision" },
];
