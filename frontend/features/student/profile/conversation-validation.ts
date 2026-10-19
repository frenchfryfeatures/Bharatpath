import type { CareerDetails, CareerField } from "./career-api";
import { isProfileSalary, parseSalaryLpa } from "../salary";

export type ParsedAnswer = { value: CareerDetails[string]; error?: never } | { error: string; value?: never };

const normalise = (text: string) => text.toLowerCase().replace(/[’']/g, "").replace(/[_-]/g, " ").replace(/\s+/g, " ").trim();

export function applyCareerAnswer(details: CareerDetails, key: string, value: CareerDetails[string]): CareerDetails {
  const next = { ...details, [key]: value };
  if (key === "work_status" && value === "FRESHER") Object.assign(next, {
    experience_years: 0, experience_months: 0, currently_employed: "NO",
    company_name: "", job_title: "", employment_start: "", employment_end: "",
    annual_salary: null, notice_period: "", job_role: "",
  });
  if (key === "currently_employed" && value === "YES") {
    next.employment_end = "";
    next.work_status = "EXPERIENCED";
  }
  if (key === "currently_employed" && value === "NO") Object.assign(next, {
    company_name: "", job_title: "", employment_start: "", employment_end: "",
    annual_salary: null, notice_period: "", job_role: "",
  });
  return next;
}

/** Deterministic parsing only: never guess values that do not match an option. */
export function parseConversationAnswer(field: CareerField, raw: string, required: boolean, details: CareerDetails): ParsedAnswer {
  const text = raw.trim();
  if (!text) {
    if (required) return { error: "Please enter an answer or choose a suggestion." };
    return { value: field.type === "list" ? [] : field.type === "number" ? (field.key.startsWith("experience_") ? 0 : null) : "" };
  }
  if (field.type === "select") {
    const input = normalise(text);
    const aliases: Record<string, Record<string, string>> = {
      work_status: { fresher: "FRESHER", "a fresher": "FRESHER", experienced: "EXPERIENCED", "i have experience": "EXPERIENCED" },
      currently_employed: { "i am working": "YES", "im working": "YES", "not working": "NO", "i am not working": "NO" },
    };
    const option = field.options.find((item) => normalise(item.label) === input || normalise(item.value) === input || aliases[field.key]?.[input] === item.value);
    return option ? { value: option.value } : { error: `Please choose or type one of these: ${field.options.map((item) => item.label).join(", ")}.` };
  }
  if (field.type === "number") {
    if (isProfileSalary(field.key)) return parseSalaryLpa(text);
    if (!/^\d+$/.test(text)) return { error: "Please enter a whole number using digits." };
    const value = Number(text);
    const currentYear = new Date().getFullYear();
    const min = field.key.endsWith("year") ? 1950 : 0;
    const max = field.key === "experience_months" ? 11 : field.key === "experience_years" ? 60 : field.key === "starting_year" ? currentYear : field.key === "passing_year" ? currentYear + 7 : 1_000_000_000;
    if (field.key === "starting_year" && value > currentYear) return { error: "The starting year cannot be in the future. Till current year allowed only." };
    if (!Number.isSafeInteger(value) || value < min || value > max) return { error: `Please enter a whole number from ${min} to ${max}.` };
    if (field.key === "passing_year" && Number(details.starting_year) > value) return { error: "Your passing year must be the same as or later than your starting year." };
    if (field.key === "starting_year" && details.passing_year && value > Number(details.passing_year)) return { error: "Your starting year must be the same as or earlier than your passing year." };
    if (field.key === "passing_year" && details.starting_year && value > Number(details.starting_year) + 7) return { error: `Your graduation year must be within 7 years of your starting year (${details.starting_year}).` };
    if (field.key === "experience_months" && details.work_status === "EXPERIENCED" && !Number(details.experience_years) && !value) return { error: "Enter at least one month of experience, or update your work status to fresher." };
    return { value };
  }
  if (field.type === "month") {
    if (!/^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(text)) return { error: "Please enter a month as YYYY-MM, for example 2024-06." };
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    if (text > currentMonth) {
      if (field.key === "employment_start") return { error: "The starting month cannot be in the future. Till current month allowed only." };
      if (field.key === "employment_end") return { error: "The ending month cannot be in the future. Till current month allowed only." };
      return { error: "The month cannot be in the future. Till current month allowed only." };
    }
    if (field.key === "employment_end" && details.employment_start && text < String(details.employment_start)) return { error: "The ending month must be after the starting month." };
    return { value: text };
  }
  if (field.type === "tel") return /^\+[1-9]\d{7,14}$/.test(text) ? { value: text } : { error: "Enter a valid mobile number for the selected country." };
  if (field.type === "list") {
    const values = [...new Set(text.split(",").map((item) => item.trim()).filter(Boolean))];
    const maxItems = field.key === "preferred_locations" ? 5 : 100;
    const maxLength = field.key === "preferred_locations" ? 100 : 80;
    if (!values.length || values.length > maxItems || values.some((item) => item.length > maxLength || !/[\p{L}\p{N}]/u.test(item))) return { error: `Enter up to ${maxItems} comma-separated items, each with 1–${maxLength} characters.` };
    return { value: values };
  }
  if (text.length > 300 || !/[\p{L}\p{N}]/u.test(text)) return { error: "Please enter a meaningful answer with up to 300 characters." };
  return { value: text };
}
