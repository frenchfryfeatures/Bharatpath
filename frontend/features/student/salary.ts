import type { CareerDetails } from "./profile/career-api";
import type { SalaryPeriod } from "../jobs/job-details";

const RUPEES_PER_LPA = 100_000;
const PAISE_PER_LPA = RUPEES_PER_LPA * 100;
const MAX_PROFILE_RUPEES = 1_000_000_000;

export const isProfileSalary = (key: string) => key === "annual_salary" || key === "preferred_salary";

export function profileFieldLabel(key: string, label: string): string {
  if (key === "annual_salary") return "Current annual salary (LPA)";
  if (key === "preferred_salary") return "Preferred annual salary (LPA)";
  if (key === "passing_year") return "Graduation or expected graduation year";
  return label;
}

export function salaryInputFromRupees(value: CareerDetails[string]): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value / RUPEES_PER_LPA) : "";
}

export function formatSalaryLpaFromRupees(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "Not added";
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 5 }).format(value / RUPEES_PER_LPA)} LPA`;
}

export function formatSalaryLpaFromPaise(value: number, period: SalaryPeriod = "MONTHLY"): string {
  const annualMultiplier = period === "ANNUAL" ? 1 : period === "DAILY" ? 260 : period === "HOURLY" ? 2_080 : 12;
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 5 }).format(value * annualMultiplier / PAISE_PER_LPA);
}

export function parseSalaryLpa(raw: string): { value: number; error?: never } | { error: string; value?: never } {
  const text = raw.trim().replace(/\s*LPA$/i, "").trim();
  if (!/^\d+(?:\.\d{1,5})?$/.test(text)) return { error: "Enter a salary in LPA, using up to five decimal places." };
  const rupees = Math.round(Number(text) * RUPEES_PER_LPA);
  if (!Number.isSafeInteger(rupees) || rupees > MAX_PROFILE_RUPEES)
    return { error: "Enter a salary from 0 to 10,000 LPA." };
  return { value: rupees };
}
