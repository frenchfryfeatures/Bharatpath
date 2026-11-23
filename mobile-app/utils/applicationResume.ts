import type { ResumeVersionSummary } from '@/services/api/resume';

export function selectApplicationResume(versions: ResumeVersionSummary[]) {
  return versions.filter(version => version.confirmed).sort((a, b) =>
    (b.confirmed_at || b.created_at).localeCompare(a.confirmed_at || a.created_at))[0];
}
