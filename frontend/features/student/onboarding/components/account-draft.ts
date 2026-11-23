import type { AccountDraft } from "./account-steps";

const key = "bharatpath:signup:account-draft:v1";
let memory: AccountDraft | undefined;

export function readAccountDraft(): AccountDraft {
  if (memory) return memory;
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as AccountDraft | null;
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    for (const field of ["fullName", "email", "phone", "city", "workStatus", "referralCode", "resumeName"] as const) {
      if (value[field] !== undefined && typeof value[field] !== "string") return {};
    }
    if (value.touched !== undefined && (!Array.isArray(value.touched) || value.touched.some((field) => typeof field !== "string"))) return {};
    if (value.resumeDetails !== undefined && (!value.resumeDetails || typeof value.resumeDetails !== "object" || Array.isArray(value.resumeDetails))) return {};
    const { fullName, email, phone, city, workStatus, referralCode, resumeDetails, touched, resumeName } = value;
    return { fullName, email, phone, city, workStatus, referralCode, resumeDetails, touched, resumeName };
  } catch { return {}; }
}

export function writeAccountDraft(draft: AccountDraft) {
  // File objects survive route remounts in memory, never in browser storage.
  const { fullName, email, phone, city, workStatus, referralCode, resumeDetails, touched, resumeName } = draft;
  const safe = { fullName, email, phone, city, workStatus, referralCode, resumeDetails, touched, resumeName };
  memory = { ...safe, file: draft.file };
  try {
    sessionStorage.setItem(key, JSON.stringify(safe));
  } catch { /* The in-memory draft still works if storage is disabled. */ }
}

export function clearAccountDraft() {
  memory = undefined;
  try { sessionStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
}
