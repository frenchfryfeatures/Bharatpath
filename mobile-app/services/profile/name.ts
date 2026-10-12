/**
 * Resolving the candidate's own name, and repairing it when it is missing.
 *
 * `candidate_profiles.full_name` is the source of truth. It is written by
 * `PUT /candidate/profile/name` at sign-up - but that call used to be
 * best-effort, so accounts exist whose profile row was never created and
 * whose Home header therefore had no name to show.
 *
 * The order here is deliberate:
 *   1. the stored profile name;
 *   2. the name typed into this session's sign-up, retried if its original
 *      save failed;
 *   3. the name on the structured resume form.
 *
 * (3) is the same fallback the backend uses when an employer opens a profile
 * (`resume.service.declared_name`), and it is safe for the same reason: only
 * the structured form carries a name. An uploaded or pasted CV is stored as
 * text, so nothing here guesses a name from a document.
 *
 * Whatever is resolved is written back, so the repair happens once.
 */
import { getCandidateProfile, updateCandidateName } from '@/services/api/auth';
import { getResumeVersionDetails, listResumeVersions } from '@/services/api/resume';
import { clearUnsavedName, rememberUnsavedName, takeUnsavedName } from './pendingName';
import { getStoredCandidateName, saveStoredCandidateName } from '@/services/storage/authStorage';

export async function resolveCandidateFullName(seed?: string | null): Promise<string | null> {
  const stored = (await getCandidateProfile().catch(() => null))?.full_name?.trim();
  if (stored) {
    clearUnsavedName();
    saveStoredCandidateName(stored);
    return stored;
  }

  const cached = await getStoredCandidateName();
  if (cached && cached.trim()) {
    return cached.trim();
  }

  const recovered = seed?.trim() || takeUnsavedName() || (await formName());
  if (!recovered) return null;

  const saved = await updateCandidateName(recovered).catch((error) => {
    console.warn('[Profile] could not save the candidate name', error);
    return null;
  });
  if (saved) {
    clearUnsavedName();
    saveStoredCandidateName(saved.full_name?.trim() || recovered);
  } else {
    rememberUnsavedName(recovered);
  }
  return saved?.full_name?.trim() || recovered;
}

/** The name on the structured form, from the confirmed version if there is one. */
async function formName(): Promise<string | null> {
  try {
    const versions = await listResumeVersions();
    if (versions.length === 0) return null;
    const preferred =
      versions.find((version) => version.confirmed && !version.superseded) ??
      versions.find((version) => !version.superseded) ??
      versions.find((version) => version.confirmed) ??
      versions[0];
    const detail = await getResumeVersionDetails(preferred.resume_version_id);
    return detail.parsed?.full_name?.trim() || null;
  } catch {
    return null;
  }
}
