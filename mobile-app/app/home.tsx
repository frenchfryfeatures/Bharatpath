/**
 * BharatPath - Home Screen Route
 * Main application landing dashboard.
 */
import { saveStoredCandidateScore } from '@/services/storage/authStorage';
import { navigateToTab } from '@/utils/tabNavigation';
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
  UI_SCORE_MAX,
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
    setCandidateScore,
  } = useAuthContext();
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
              router.replace('/?step=review');
            }
            return;
          }
          if (isMounted) {
            // The gate's answer is the fresh score: use it rather than
            // fetching it a second time (2026-11-23).
            setCandidateScore(score);
            saveStoredCandidateScore(score);
            refreshPhoto().catch(() => undefined);
          }
        } catch (err) {
          const isOfflineOrTimeout =
            err != null &&
            typeof err === 'object' &&
            'status' in err &&
            (err as { status?: number }).status === 0;
          const hasCachedReadyScore =
            candidateScore?.status === 'READY' && candidateScore.value != null;
          if (isMounted && !(isOfflineOrTimeout && hasCachedReadyScore)) {
            router.replace('/?step=review');
          }
        }
      }
      verifyScoreGate();
      return () => {
        isMounted = false;
      };
    }, [router, refreshPhoto, setCandidateScore])
  );

  const handleTabPress = (tab: TabName, href: string) => {
    navigateToTab(router, 'home', tab, href);
  };

  return (
    <HomeScreen
      onRefresh={() => Promise.all([refreshScore(), refreshPhoto()])}
      candidateName={candidateFullName || undefined}
      photoUrl={candidatePhotoUrl}
      score={
        candidateScore?.status === 'READY'
          ? (candidateScore.value ?? undefined)
          : undefined
      }
      maxScore={UI_SCORE_MAX}
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
      activeTab="home"
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
