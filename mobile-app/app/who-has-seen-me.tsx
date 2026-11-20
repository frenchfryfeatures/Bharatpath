/**
 * BharatPath - Who Has Seen Me Route
 * Unlocks activity log and privacy settings matching Screen 41 in Handoff & Screenshot 2.
 */
import React from 'react';
import { useRouter } from 'expo-router';
import { WhoHasSeenMeScreen } from '@/screens/profile/WhoHasSeenMeScreen';

export default function WhoHasSeenMeRoute() {
  const router = useRouter();

  return (
    <WhoHasSeenMeScreen
      onBack={() => router.back()}
    />
  );
}
