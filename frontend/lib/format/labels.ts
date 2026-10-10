/** "CANDIDATE_MONTHLY" -> "Candidate monthly": a backend code made readable. */
export function humanizeCode(code: string | null | undefined): string {
  if (!code) return "";
  const text = code.replace(/[_-]+/g, " ").trim().toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}
