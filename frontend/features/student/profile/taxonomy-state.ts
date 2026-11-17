import type { CareerDetails } from "./career-api";

export const taxonomyKeys = ["industry", "department", "role_category", "job_role"] as const;
export type TaxonomyKey = typeof taxonomyKeys[number];
export interface TaxonomyOption { id: string; name: string }
export const isTaxonomyKey = (key: string): key is TaxonomyKey => taxonomyKeys.includes(key as TaxonomyKey);
export const taxonomyOthers = (details: CareerDetails): Record<string, string> => {
  const value = details.taxonomy_others;
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
};
export function taxonomyState(details: CareerDetails, key: TaxonomyKey) {
  const index = taxonomyKeys.indexOf(key);
  const parent = taxonomyKeys[index - 1];
  const others = taxonomyOthers(details);
  const freeText = taxonomyKeys.slice(0, index).some((k) => Object.hasOwn(others, k) || (!details[k + "_id"] && Boolean(details[k])));
  const id = String(details[key + "_id"] || "");
  return { freeText, disabled: index > 0 && !freeText && !details[parent + "_id"],
    other: Object.hasOwn(others, key) || (!id && Boolean(details[key])),
    id, parentId: parent ? String(details[parent + "_id"] || "") : "" };
}
export function chooseTaxonomy(details: CareerDetails, key: TaxonomyKey, option: TaxonomyOption | "other" | null): CareerDetails {
  const next = { ...details };
  const others = { ...taxonomyOthers(details) };
  for (const child of taxonomyKeys.slice(taxonomyKeys.indexOf(key))) {
    next[child] = "";
    next[child + "_id"] = null;
    delete others[child];
  }
  if (option === "other") others[key] = "";
  else if (option) { next[key] = option.name; next[key + "_id"] = option.id; }
  next.taxonomy_others = others;
  return next;
}
export function writeTaxonomyText(details: CareerDetails, key: TaxonomyKey, value: string): CareerDetails {
  const next = chooseTaxonomy(details, key, "other");
  next[key] = value.replace(/[<>\u0000-\u001f\u007f]/g, "").slice(0, 160);
  next.taxonomy_others = { ...taxonomyOthers(next), [key]: String(next[key]) };
  return next;
}
export function taxonomyErrors(details: CareerDetails): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const key of taxonomyKeys) {
    if (key === "job_role" && details.work_status === "FRESHER") continue;
    const state = taxonomyState(details, key);
    if (Object.hasOwn(taxonomyOthers(details), key) && !String(details[key] || "").trim())
      errors[key] = "Enter your answer for Others, or choose an option from the list.";
    if (state.disabled && details[key + "_id"]) errors[key] = "Choose the preceding field first.";
  }
  return errors;
}
export function taxonomyPath(key: TaxonomyKey, parentId: string): string {
  if (key === "industry") return "/taxonomy/industries";
  const [path, param] = key === "department" ? ["departments", "industry_id"] : key === "role_category" ? ["categories", "department_id"] : ["roles", "category_id"];
  return `/taxonomy/${path}?${param}=${encodeURIComponent(parentId)}&limit=1000`;
}
