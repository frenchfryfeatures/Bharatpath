/**
 * BharatPath - Home Screen Route
 * Main application landing dashboard.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { HomeScreen } from '@/screens/home/HomeScreen';
import { TabName } from '@/components/navigation/BottomTabBar';
import { useAuthContext } from '@/context/AuthContext';
import { useScoreChange } from '@/hooks/useScoreChange';
import {
  getMyScore,
  CandidateScoreResponse,
  bandIndex,
  bandLabel,
  nextBandLabel,
  pointsToNextBand,
} from '@/services/api/scoring';

export default function HomeRoute() {
  const router = useRouter();
  const {
    session,
    candidateFullName,
    candidateScore,
    refreshScore,
    candidatePhotoUrl,
    refreshPhoto,
  } = useAuthContext();
  const [activeTab, setActiveTab] = useState<TabName>('home');
  const scoreGain = useScoreChange(session?.userId, candidateScore);

  // Re-fetch score and photo on screen focus & ensure candidate has completed scoring
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      async function verifyScoreGate() {
        try {
          const score = await getMyScore();
          if (!score || score.status !== 'READY' || score.value == null) {
            if (isMounted) {
              router.replace('/?step=intake');
            }
            return;
          }
          if (isMounted) {
            refreshScore().catch(() => undefined);
            refreshPhoto().catch(() => undefined);
          }
        } catch {
          if (isMounted) {
            router.replace('/?step=intake');
          }
        }
      }
      verifyScoreGate();
      return () => {
        isMounted = false;
      };
    }, [router, refreshScore, refreshPhoto])
  );

  const handleTabPress = (tab: TabName, href: string) => {
    setActiveTab(tab);
    if (tab !== 'home') {
      router.push(href as any);
    }
  };

  return (
    <HomeScreen
      candidateName={candidateFullName || undefined}
      photoUrl={candidatePhotoUrl}
      score={
        candidateScore?.status === 'READY'
          ? (candidateScore.value ?? undefined)
          : undefined
      }
      maxScore={999}
      scoreGain={scoreGain}
      bandName={bandLabel(candidateScore?.band) || undefined}
      bandNumber={bandIndex(candidateScore?.band)}
      bandTotal={4}
      pointsToNextBand={
        pointsToNextBand(
          candidateScore?.value ?? null,
          candidateScore?.band ?? null,
        ) ?? 28
      }
      nextBandName={nextBandLabel(candidateScore?.band ?? null) || undefined}
      activeTab={activeTab}
      onTabPress={handleTabPress}
      onExploreJobs={() => router.push('/jobs')}
      onAllJobsPress={() => router.push('/jobs')}
      onJobPress={(jobId) =>
        router.push({ pathname: '/job-detail', params: { id: jobId } } as any)
      }
      onScorePress={() =>
        router.push({
          pathname: '/share-result',
          params: {
            score:
              candidateScore?.status === 'READY' && candidateScore?.value != null
                ? String(candidateScore.value)
                : '',
            bandName: bandLabel(candidateScore?.band) || '',
          },
        } as any)
      }
      onAttributeCheckPress={() => router.push('/attribute-check' as any)}
      onMockInterviewPress={() => router.push('/mock-interview' as any)}
      onNotificationsPress={() => router.push('/notifications' as any)}
      onProfilePress={() => router.push('/you' as any)}
      onStreakPress={() => router.push('/streak' as any)}
      onCoursesPress={() => router.push('/courses' as any)}
    />
  );
}
