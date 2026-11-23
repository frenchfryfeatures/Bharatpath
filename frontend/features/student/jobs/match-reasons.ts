/** Words for the job engine's reason codes (2026-11-23). Never a number. */
export const MATCH_REASON_LABELS: Record<string, string> = {
  STRONG_SKILLS_MATCH: 'Strong skills match',
  SOME_SKILLS_MATCH: 'Some of your skills',
  ROLE_MATCH: 'Matches your preferred role',
  EXPERIENCE_FITS: 'Experience requirements align',
  PREFERRED_LOCATION: 'In your preferred location',
  REMOTE: 'Remote',
  SALARY_FITS: 'Salary fits your expectation',
  EDUCATION_FITS: 'Meets the education requirement',
  INDUSTRY_MATCH: 'In your industry',
  ENTRY_LEVEL: 'Open to freshers',
};

export function matchReasonText(reasons: string[] | undefined, max = 2): string | null {
  const words = (reasons ?? []).map((code) => MATCH_REASON_LABELS[code]).filter(Boolean);
  return words.length ? words.slice(0, max).join(' · ') : null;
}
