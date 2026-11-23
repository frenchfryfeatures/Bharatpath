/**
 * BharatPath - Job Preferences Route (2026-11-23)
 * Opened from the profile's "Job preferences" row.
 */
import { useRouter } from 'expo-router';
import { JobPreferencesScreen } from '@/screens/profile/JobPreferencesScreen';

export default function JobPreferencesRoute() {
  const router = useRouter();
  return (
    <JobPreferencesScreen
      onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/you' as any);
      }}
      onOpenProfile={() => router.replace('/profile-details' as any)}
    />
  );
}
