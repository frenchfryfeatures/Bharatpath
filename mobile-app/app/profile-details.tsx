import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { listResumeVersions } from '@/services/api/resume';
import { CareerDetailsScreen } from '@/screens/profile/CareerDetailsScreen';

export default function ProfileDetailsRoute() {
  const router = useRouter();
  const [versionId, setVersionId] = useState<string>();
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    listResumeVersions()
      .then((versions) =>
        setVersionId(versions.find((v) => !v.superseded)?.resume_version_id),
      )
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);
  if (loading)
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#5F4DB2" />
      </View>
    );
  return (
    <CareerDetailsScreen
      versionId={versionId}
      onBack={() =>
        router.canGoBack() ? router.back() : router.replace('/you')
      }
      onDone={() => router.replace('/you')}
    />
  );
}
