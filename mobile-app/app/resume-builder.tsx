import React from 'react';
import { useRouter } from 'expo-router';
import { ResumeBuilderScreen } from '@/screens/onboarding/ResumeBuilderScreen';

export default function ResumeBuilderRoute() {
  const router = useRouter();

  return (
    <ResumeBuilderScreen
      onBack={() => router.back()}
      onDone={(versionId) => {
        router.replace({
          pathname: '/',
          params: { step: 'subscribe' },
        });
      }}
      onUploadCv={() => {
        router.replace({
          pathname: '/',
          params: { step: 'intake' },
        });
      }}
    />
  );
}
