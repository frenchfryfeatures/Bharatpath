import type {
  ApplicationStatus,
  JobApplication,
  JobListing,
  ScoreScale,
} from "./types";
import { formatSalaryLpaFromPaise } from "./salary";

const STAGE_ORDER: ApplicationStatus[] = [
  "SUBMITTED",
  "VIEWED",
  "SHORTLISTED",
  "INTERVIEW",
  "DECISION",
  "HIRED",
];

export function initials(name: string | null | undefined): string {
  if (!name) return "ST";
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function firstName(name: string | null | undefined): string {
  return name?.trim().split(/\s+/)[0] || "there";
}

export function employerMonogram(name: string | null): string {
  return initials(name || "Employer");
}

/** "SOLID" -> "Solid". The band code itself comes from the backend. */
export function bandLabel(band: string | null | undefined): string {
  if (!band) return "Not available";
  const lower = band.replace(/_/g, " ").toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * The position of a band on the scale. Prefers the band code the backend
 * returned with the score; falls back to the value's range only if the code is
 * missing. -1 when neither places it.
 */
export function bandIndex(
  scale: ScoreScale,
  band: string | null | undefined,
  value?: number | null,
): number {
  if (band) {
    const byCode = scale.bands.findIndex((range) => range.band === band);
    if (byCode >= 0) return byCode;
  }
  if (value != null) {
    return scale.bands.findIndex(
      (range) => value >= range.lowest && value <= range.highest,
    );
  }
  return -1;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatSalary(job: JobListing): string {
  if (!job.salaryDisclosed || job.details?.compensation.disclosed === false) return "Not disclosed";
  // Job board summaries omit the period; new employer postings default to monthly.
  const period = job.details?.compensation.period || "MONTHLY";
  return `₹${formatSalaryLpaFromPaise(job.salaryMinMinor, period)}–${formatSalaryLpaFromPaise(job.salaryMaxMinor, period)} LPA`;
}

export function workModeLabel(
  mode: JobListing["workMode"],
): string {
  if (!mode) return "Work mode not specified";
  return mode[0] + mode.slice(1).toLowerCase();
}

export function stageLabel(stage: ApplicationStatus): string {
  return {
    SUBMITTED: "Sent",
    VIEWED: "Viewed",
    SHORTLISTED: "Shortlisted",
    INTERVIEW: "Interview",
    DECISION: "Decision",
    HIRED: "Hired",
    REJECTED: "Closed",
    WITHDRAWN: "Withdrawn",
    EXPIRED: "Expired",
  }[stage];
}

/** Withdrawn, not selected or expired: closed without a hire. */
export function isClosedWithoutHire(stage: ApplicationStatus): boolean {
  return stage === "REJECTED" || stage === "WITHDRAWN" || stage === "EXPIRED";
}

/**
 * "Stage N of 5" for an open application or a hire. A closed one has no
 * stage on the bar (0): it did not finish the pipeline, so it must not read
 * as "5 of 5" (2026-11-23).
 */
export function stageIndex(stage: ApplicationStatus): number {
  if (isClosedWithoutHire(stage)) return 0;
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0) return 1;
  return Math.min(5, index + 1);
}

const PIPELINE_LABELS = ["Applied", "Profile viewed", "Shortlisted", "Interview", "Decision"] as const;
const CLOSED_LABELS: Partial<Record<ApplicationStatus, string>> = {
  WITHDRAWN: "Withdrawn by you",
  REJECTED: "Not selected",
  EXPIRED: "Closed with no response",
};

export type TimelineStep = {
  label: string;
  /** `ended`: where a withdrawn, rejected or expired application closed. */
  state: "done" | "current" | "pending" | "ended";
  reached: boolean;
};

/**
 * The timeline shows only what actually happened (2026-11-23), the same
 * rule as the mobile app's `utils/applicationTimeline.ts`. An open
 * application: done, current, still to come. A closed one: the stages it
 * really reached (from its history), then how it ended -- withdrawing
 * straight after applying is "Applied", "Withdrawn by you". A hire
 * completes every stage.
 */
export function applicationTimeline(application: JobApplication): TimelineStep[] {
  const pipeline = STAGE_ORDER.slice(0, PIPELINE_LABELS.length);
  const indexOf = (stage: ApplicationStatus | null | undefined) =>
    stage ? pipeline.indexOf(stage) : -1;
  const step = (label: string, state: TimelineStep["state"]): TimelineStep => ({
    label,
    state,
    reached: state === "done",
  });
  const stage = application.stage;

  if (stage === "HIRED") return PIPELINE_LABELS.map((label) => step(label, "done"));

  if (!isClosedWithoutHire(stage)) {
    const current = Math.max(0, indexOf(stage));
    return PIPELINE_LABELS.map((label, index) =>
      step(label, index < current ? "done" : index === current ? "current" : "pending"),
    );
  }

  let reached = 0;
  for (const event of application.history ?? []) {
    reached = Math.max(reached, indexOf(event.toStage), indexOf(event.fromStage));
  }
  return [
    ...PIPELINE_LABELS.slice(0, reached + 1).map((label) => step(label, "done")),
    step(CLOSED_LABELS[stage] ?? "Closed", "ended"),
  ];
}
