import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { listResumeVersions } from '@/services/api/resume';
import { getCareerProfile, type CareerProfile } from '@/services/api/career';
import { profileResumeVersion } from '@/services/profile/onboarding';
import { CareerDetailsScreen } from '@/screens/profile/CareerDetailsScreen';
import { AppAlert } from '@/components/feedback/AppAlert';

export default function ProfileDetailsRoute() {
  const router = useRouter();
  const [versionId, setVersionId] = useState<string>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      getCareerProfile(),
      listResumeVersions(),
    ])
      .then(([profile, versions]) => {
        const latest = versions.find((version) => !version.superseded);
        setVersionId(profileResumeVersion(profile, latest));
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const handleDone = async (_saved: CareerProfile) => {
    AppAlert.alert(
      'Profile Saved',
      'Your profile details have been saved successfully.',
      [{ text: 'OK' }]
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#5F4DB2" size="large" />
      </View>
    );
  }

  return (
    <CareerDetailsScreen
      versionId={versionId}
      onBack={() =>
        router.canGoBack() ? router.back() : router.replace('/you')
      }
      onUpdateResume={() => router.push('/resume-details' as any)}
      onDone={handleDone}
    />
  );
}
