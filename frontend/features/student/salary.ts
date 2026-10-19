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
  const text = raw.trim();
  if (!text) return { error: "Enter a salary, for example: 12 LPA, 50k/month, or ₹6,00,000." };

  let cleaned = text
    .replace(/[₹$€£]/g, "")
    .replace(/\b(?:rs\.?|inr)\b/gi, "")
    .replace(/,/g, "")
    .trim();

  const isMonthly = /\b(?:per\s*month|\/\s*month|\/\s*mo|pm|p\.m\.|monthly)\b/i.test(cleaned);
  cleaned = cleaned
    .replace(/\b(?:per\s*month|\/\s*month|\/\s*mo|pm|p\.m\.|monthly)\b/gi, "")
    .replace(/\b(?:per\s*year|\/\s*year|\/\s*yr|per\s*annum|annually|annual|p\.a\.)\b/gi, "")
    .trim();

  // Crores
  const crMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:cr(?:ores?)?)$/i);
  if (crMatch) {
    const val = Number(crMatch[1]);
    if (!Number.isFinite(val) || val <= 0) return { error: "Please enter a valid amount in Crores (e.g. 1.5 Cr)." };
    const rupees = Math.round(val * 10_000_000 * (isMonthly ? 12 : 1));
    if (rupees > MAX_PROFILE_RUPEES) return { error: "Salary exceeds the maximum limit of ₹100 Crore." };
    return { value: rupees };
  }

  // LPA / Lakhs
  const lpaMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:lpa|lakhs?|lacs?|l)$/i);
  if (lpaMatch) {
    const val = Number(lpaMatch[1]);
    if (!Number.isFinite(val) || val <= 0) return { error: "Please enter a valid amount (e.g. 12 LPA)." };
    const rupees = Math.round(val * RUPEES_PER_LPA * (isMonthly ? 12 : 1));
    if (rupees > MAX_PROFILE_RUPEES) return { error: "Salary exceeds the maximum limit of ₹100 Crore." };
    return { value: rupees };
  }

  // Thousands / K
  const kMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s*(?:k|thousands?)$/i);
  if (kMatch) {
    const val = Number(kMatch[1]);
    if (!Number.isFinite(val) || val <= 0) return { error: "Please enter a valid amount (e.g. 50k/month)." };
    const rupees = Math.round(val * 1_000 * (isMonthly ? 12 : 1));
    if (rupees > MAX_PROFILE_RUPEES) return { error: "Salary exceeds the maximum limit of ₹100 Crore." };
    return { value: rupees };
  }

  // Numbers
  if (/^\d+(?:\.\d+)?$/.test(cleaned)) {
    const num = Number(cleaned);
    if (!Number.isFinite(num) || num < 0) return { error: "Please enter a valid positive salary." };
    if (num === 0) return { value: 0 };
    let rupees: number;
    if (isMonthly) {
      rupees = Math.round((num <= 500 ? num * RUPEES_PER_LPA : num) * 12);
    } else {
      rupees = Math.round(num <= 500 ? num * RUPEES_PER_LPA : num);
    }
    if (rupees > MAX_PROFILE_RUPEES) return { error: "Salary exceeds the maximum limit of ₹100 Crore." };
    return { value: rupees };
  }

  return { error: "Enter a salary, for example: 12 LPA, 50k/month, or ₹6,00,000." };
}
