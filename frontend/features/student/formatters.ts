import type {
  ApplicationStatus,
  JobApplication,
  JobListing,
  ScoreScale,
} from "./types";

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
  if (!job.salaryDisclosed) return "Not disclosed";
  const formatter = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  });
  return `${formatter.format(job.salaryMinMinor / 100)}–${formatter.format(
    job.salaryMaxMinor / 100,
  )}`;
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

export function stageIndex(stage: ApplicationStatus): number {
  if (stage === "REJECTED" || stage === "WITHDRAWN" || stage === "EXPIRED") {
    return 5;
  }
  const index = STAGE_ORDER.indexOf(stage);
  if (index < 0) return 1;
  return Math.min(5, index + 1);
}

export function applicationTimeline(application: JobApplication) {
  const labels = ["Applied", "Profile viewed", "Shortlisted", "Interview", "Decision"];
  const current = stageIndex(application.stage);
  return labels.map((label, index) => ({
    label,
    reached: index < current,
  }));
}
