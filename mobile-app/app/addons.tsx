/**
 * BharatPath - Add-ons Route (2026-11-23)
 * Opened from the profile's Add-ons card: every way to earn a reward.
 */
import { useRouter } from 'expo-router';
import { AddOnsScreen } from '@/screens/profile/AddOnsScreen';

export default function AddOnsRoute() {
  const router = useRouter();
  return (
    <AddOnsScreen
      onBack={() => {
        if (router.canGoBack()) router.back();
        else router.replace('/you' as any);
      }}
      onOpen={(route) => router.push(route as any)}
    />
  );
}
