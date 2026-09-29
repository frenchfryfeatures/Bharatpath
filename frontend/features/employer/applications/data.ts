import type {
  ApplicationColumnDefinition,
  EmployerApplication,
} from "./types";

export const APPLICATION_COLUMNS: ApplicationColumnDefinition[] = [
  {
    id: "submitted",
    label: "Submitted",
    stage: 0,
    emptyMessage: "No new applications yet",
  },
  {
    id: "viewed",
    label: "Viewed",
    stage: 1,
    emptyMessage: "Nothing viewed yet",
  },
  {
    id: "shortlisted",
    label: "Shortlisted",
    stage: 2,
    emptyMessage: "Shortlist candidates to see them here",
  },
  {
    id: "interview",
    label: "Interview",
    stage: 3,
    emptyMessage: "No interviews scheduled",
  },
  {
    id: "decision",
    label: "Decision",
    stage: 4,
    outcome: null,
    emptyMessage: "No applications awaiting a decision",
  },
  {
    id: "hired",
    label: "Hired",
    stage: 4,
    outcome: "hired",
    emptyMessage: "No hires recorded yet",
  },
  {
    id: "rejected",
    label: "Rejected",
    stage: 4,
    outcome: "rejected",
    emptyMessage: "No rejections recorded yet",
  },
  {
    id: "withdrawn",
    label: "Withdrawn",
    stage: 4,
    outcome: "withdrawn",
    emptyMessage: "No withdrawn applications",
  },
  {
    id: "expired",
    label: "Expired",
    stage: 4,
    outcome: "expired",
    emptyMessage: "No expired applications",
  },
];

export const INITIAL_APPLICATIONS: EmployerApplication[] = [
  {
    id: "a1",
    jobId: "j1",
    jobLocation: null,
    candidate: {
      id: "c2",
      name: "A. Kulkarni",
      initials: "AK",
      exactScore: 855,
      location: "Pune · Hinjewadi",
      jobTitle: "Lab Analyst Trainee",
      unlocked: false,
    },
    stage: 3,
    outcome: null,
    appliedDate: "20 Jul 2026",
    meetingLink: "",
  },

  {
    id: "a2",
    jobId: "j1",
    jobLocation: null,
    candidate: {
      id: "c3",
      name: "R. Patil",
      initials: "RP",
      exactScore: 921,
      location: "Nashik",
      jobTitle: "Lab Analyst Trainee",
      unlocked: false,
    },
    stage: 4,
    outcome: "hired",
    appliedDate: "2 Jul 2026",
    meetingLink:
      "https://meet.google.com/abc-defg-hij",
    hireEmployerConfirmed: true,
    hireCandidateConfirmed: true,
  },

  {
    id: "a3",
    jobId: "j1",
    jobLocation: null,
    candidate: {
      id: "c5",
      name: "V. Joshi",
      initials: "VJ",
      exactScore: 764,
      location: "Pune · Kothrud area",
      jobTitle: "Lab Analyst Trainee",
      unlocked: false,
    },
    stage: 1,
    outcome: null,
    appliedDate: "25 Aug 2026",
    meetingLink: "",
  },

  {
    id: "a4",
    jobId: "j2",
    jobLocation: null,
    candidate: {
      id: "c6",
      name: "N. Gaikwad",
      initials: "NG",
      exactScore: 855,
      location: "Pune · Wakad",
      jobTitle: "Quality Control Trainee",
      unlocked: false,
    },
    stage: 2,
    outcome: null,
    appliedDate: "14 Aug 2026",
    meetingLink: "",
  },

  {
    id: "a5",
    jobId: "j2",
    jobLocation: null,
    candidate: {
      id: "c1",
      name: "S. Deshmukh",
      initials: "SD",
      exactScore: 688,
      location: "Pune · Kothrud area",
      jobTitle: "Quality Control Trainee",
      unlocked: false,
    },
    stage: 4,
    outcome: "rejected",
    appliedDate: "30 Jun 2026",
    meetingLink: "",
  },

  {
    id: "a6",
    jobId: "j4",
    jobLocation: null,
    candidate: {
      id: "c4",
      name: "M. Shaikh",
      initials: "MS",
      exactScore: 688,
      location: "Aurangabad",
      jobTitle: "Packaging Operator",
      unlocked: false,
    },
    stage: 0,
    outcome: null,
    appliedDate: "29 Aug 2026",
    meetingLink: "",
  },

  {
    id: "a7",
    jobId: "j1",
    jobLocation: null,
    candidate: {
      id: "c6",
      name: "N. Gaikwad",
      initials: "NG",
      exactScore: 855,
      location: "Pune · Wakad",
      jobTitle: "Lab Analyst Trainee",
      unlocked: false,
    },
    stage: 3,
    outcome: null,
    appliedDate: "10 Aug 2026",
    meetingLink: "",
    hireEmployerConfirmed: false,
  },
];

export const APPLICATION_JOB_OPTIONS = [
  {
    value: "all",
    label: "All jobs",
  },
  {
    value: "j1",
    label: "Lab Analyst Trainee",
  },
  {
    value: "j2",
    label: "Quality Control Trainee",
  },
  {
    value: "j4",
    label: "Packaging Operator",
  },
];