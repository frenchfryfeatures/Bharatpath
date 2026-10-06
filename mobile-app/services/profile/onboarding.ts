import type { CareerProfile } from '../api/career';

export const passwordRequirements = (password: string) => [
  { label: 'At least 12 characters', met: password.length >= 12 },
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
