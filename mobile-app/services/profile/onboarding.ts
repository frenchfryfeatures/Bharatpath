import type { CareerField, CareerProfile } from '../api/career';

/** Keep required contact corrections in conversational Step 2. */
export function conversationStartStep(target: number, missing: string[]): number {
  return target > 1 && missing.some((key) => key === 'phone' || key === 'current_city')
    ? 1
    : target;
}

export function conversationFieldsForSection(
  fields: CareerField[],
  sectionKey: string | undefined,
  stepIndex: number,
  visible: (field: CareerField) => boolean,
): CareerField[] {
  return fields.filter((field) =>
    (field.section === sectionKey ||
      (stepIndex === 1 && (field.key === 'phone' || field.key === 'current_city'))) &&
    visible(field),
  );
}

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

export function nextAfterProfile(
  profile: Pick<CareerProfile, 'completed' | 'resume_file_id' | 'resume_version_id'>,
  hasAccess: boolean,
): 'review' | 'resume-required' | 'subscribe' | 'paid-scoring' {
  if (!profile.completed) return 'review';
  if (!profile.resume_file_id || !profile.resume_version_id) return 'resume-required';
  return hasAccess ? 'paid-scoring' : 'subscribe';
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
