import type { CareerDetails } from "./career-api";

export const educationKeys = ["highest_qualification", "course", "specialization"] as const;
export type EducationKey = typeof educationKeys[number];
export interface EducationOption { id: string; name: string; is_not_applicable?: boolean; level_rank?: number }
export const isEducationKey = (key: string): key is EducationKey => educationKeys.includes(key as EducationKey);
export const educationOthers = (details: CareerDetails): Record<string, string> => {
  const value = details.education_others;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};
export function educationState(details: CareerDetails, key: EducationKey) {
  const index = educationKeys.indexOf(key);
  const parent = educationKeys[index - 1];
  const others = educationOthers(details);
  const freeText = educationKeys.slice(0, index).some((k) => Object.hasOwn(others, k) || (!details[k + "_id"] && Boolean(details[k])));
  const id = String(details[key + "_id"] || "");
  return { freeText, disabled: index > 0 && !freeText && !details[parent + "_id"],
    other: Object.hasOwn(others, key) || (!id && Boolean(details[key])),
    id, parentId: parent ? String(details[parent + "_id"] || "") : "" };
}
export function chooseEducation(details: CareerDetails, key: EducationKey, option: EducationOption | "other" | null): CareerDetails {
  const next = { ...details };
  const others = { ...educationOthers(details) };
  for (const child of educationKeys.slice(educationKeys.indexOf(key))) {
    next[child] = "";
    next[child + "_id"] = null;
    delete others[child];
  }
  if (option === "other") others[key] = "";
  else if (option) { next[key] = option.name; next[key + "_id"] = option.id; }
  next.education_others = others;
  return next;
}
export function writeEducationText(details: CareerDetails, key: EducationKey, value: string): CareerDetails {
  const next = chooseEducation(details, key, "other");
  next[key] = value.replace(/[<>\u0000-\u001f\u007f]/g, "").slice(0, 160);
  next.education_others = { ...educationOthers(next), [key]: String(next[key]) };
  return next;
}
export function educationErrors(details: CareerDetails): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of educationKeys) {
    const state = educationState(details, key);
    if ((state.freeText || Object.hasOwn(educationOthers(details), key)) && !String(details[key] || "").trim())
      errors[key] = "Enter your answer for Others, or choose an option from the list.";
    if (state.disabled && details[key + "_id"]) errors[key] = "Choose the preceding field first.";
  }
  return errors;
}
export function educationPath(key: EducationKey, parentId: string): string {
  if (key === "highest_qualification") return "/education-taxonomy/qualifications?limit=1000";
  return `/education-taxonomy/${key === "course" ? "courses?qualification_id" : "specializations?course_id"}=${encodeURIComponent(parentId)}&limit=1000`;
}
export function autoNAOption(items: EducationOption[], details: CareerDetails): EducationOption | null {
  if (items.length !== 1 || !items[0].is_not_applicable) return null;
  if (educationOthers(details).specialization !== undefined) return null;
  if (details.specialization_id && details.specialization_id !== items[0].id) return null;
  if (!details.specialization_id && details.specialization) return null;
  return items[0];
}
