import type { CareerProfile } from '../api/career';

export const passwordRequirements = (password: string) => [
  { label: 'At least 8 characters', met: password.length >= 8 },
  { label: 'An uppercase letter', met: /[A-Z]/.test(password) },
  { label: 'A lowercase letter', met: /[a-z]/.test(password) },
  { label: 'A number', met: /[0-9]/.test(password) },
];

export function onboardingDestination(
  profile: CareerProfile,
  latest?: { resume_version_id: string; confirmed: boolean },
): 'home' | 'subscribe' | 'review' {
  if (latest?.confirmed) return 'home';
  if (latest && profile.completed && profile.resume_version_id === latest.resume_version_id)
    return 'subscribe';
  return 'review';
}

export function membershipResumeVersion(
  profile: Pick<CareerProfile, 'completed' | 'resume_version_id'>,
): string | undefined {
  return profile.completed
    ? profile.resume_version_id ?? undefined
    : undefined;
}

/**
 * Profile pages follow the resume already linked to the saved career profile.
 * A newer version is imported only for legacy profiles that have no link yet,
 * matching the web CareerOverview behavior.
 */
export function profileResumeVersion(
  profile: Pick<CareerProfile, 'resume_version_id'>,
  latest?: { resume_version_id: string },
): string | undefined {
  return profile.resume_version_id ?? latest?.resume_version_id;
}
