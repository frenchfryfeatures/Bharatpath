import type { CareerDetails } from "./career-api";
import type { ConversationAnswer } from "./conversation-questions";

export interface OnboardingDraft {
  details: CareerDetails;
  fullName: string;
  mode: "manual" | "conversation" | null;
  step: number;
  questionIndex: number;
  stepDone?: boolean;
  history: ConversationAnswer[];
  input: string | null;
}

// Mode survives component remounts, but intentionally resets on a full reload.
const currentVisit = new Map<string, OnboardingDraft>();
export function readOnboardingDraft(key: string): { draft: OnboardingDraft; sameVisit: boolean } | null {
  const memory = currentVisit.get(key);
  if (memory) return { draft: memory, sameVisit: true };
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const draft = JSON.parse(raw) as OnboardingDraft;
    if (!draft.details || !Array.isArray(draft.history) || !Number.isInteger(draft.step) || draft.step < 0 || draft.step > 3 || !Number.isInteger(draft.questionIndex) || draft.questionIndex < 0 || ![null, "manual", "conversation"].includes(draft.mode)) return null;
    return { draft, sameVisit: false };
  } catch { return null; }
}
export function writeOnboardingDraft(key: string, draft: OnboardingDraft) {
  currentVisit.set(key, draft);
  try { sessionStorage.setItem(key, JSON.stringify(draft)); } catch { /* In-memory progress still works when storage is unavailable. */ }
}
export function clearOnboardingDraft(key: string) {
  currentVisit.delete(key);
  try { sessionStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
}
