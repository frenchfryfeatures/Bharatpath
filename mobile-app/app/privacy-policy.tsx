import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { PrivacyPolicyScreen } from '@/screens/profile/PrivacyPolicyScreen';

export default function PrivacyPolicyRoute() {
  const router = useRouter();
  const { section } = useLocalSearchParams<{ section?: string }>();
  return <PrivacyPolicyScreen showData={section === 'your-data'} onBack={() => router.canGoBack() ? router.back() : router.replace('/you' as any)} />;
}
