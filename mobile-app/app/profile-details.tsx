import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { useRouter } from 'expo-router';
import { listResumeVersions, confirmResumeVersion } from '@/services/api/resume';
import { getCareerProfile, type CareerProfile } from '@/services/api/career';
import { getMyScore, type CandidateScoreResponse } from '@/services/api/scoring';
import { getCandidateSubscription } from '@/services/api/subscription';
import { profileResumeVersion } from '@/services/profile/onboarding';
import { CareerDetailsScreen } from '@/screens/profile/CareerDetailsScreen';
import { ScoringScreen } from '@/screens/onboarding/ScoringScreen';
import { ScoreRevealScreen } from '@/screens/onboarding/ScoreRevealScreen';
import { useAuthContext } from '@/context/AuthContext';
import { AppAlert } from '@/components/feedback/AppAlert';

type Step = 'details' | 'scoring' | 'score-reveal';

export default function ProfileDetailsRoute() {
  const router = useRouter();
  const {
    candidateScore: authScore,
    setCandidateScore,
    updateCandidateScore,
    refreshScore,
  } = useAuthContext();

  const [step, setStep] = useState<Step>('details');
  const [versionId, setVersionId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const [newScore, setNewScore] = useState<CandidateScoreResponse | null>(null);
  const previousComputedAtRef = useRef<string | null>(authScore?.computed_at || null);

  useEffect(() => {
    Promise.all([
      getCareerProfile(),
      listResumeVersions(),
      getMyScore().catch(() => null),
    ])
      .then(([profile, versions, score]) => {
        const latest = versions.find((version) => !version.superseded);
        setVersionId(profileResumeVersion(profile, latest));
        if (score?.status === 'READY') {
          previousComputedAtRef.current = score.computed_at;
        }
      })
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const handleDone = async (saved: CareerProfile) => {
    const targetVersionId = saved.resume_version_id || versionId;
    if (!targetVersionId) {
      router.replace('/you');
      return;
    }

    try {
      // 1. Verify candidate has active subscription for scoring
      const sub = await getCandidateSubscription().catch(() => null);
      if (sub && !sub.has_access) {
        AppAlert.alert(
          'Subscription Required',
          'Resume scoring requires an active BharatPath membership. Please subscribe to calculate your updated score.',
          [
            { text: 'Subscribe', onPress: () => router.push('/subscription') },
            { text: 'Later', style: 'cancel', onPress: () => router.replace('/you') },
          ]
        );
        return;
      }

      // 2. Confirm the version so the backend triggers scoring
      const confirmRes = await confirmResumeVersion(targetVersionId);
      const confAt = confirmRes?.confirmed_at || new Date().toISOString();
      setConfirmedAt(confAt);

      // 3. Move to scoring screen
      setStep('scoring');
    } catch (err: any) {
      if (err?.code === 'subscription_required' || err?.status === 402) {
        AppAlert.alert(
          'Subscription Required',
          'Resume scoring requires an active BharatPath membership. Please subscribe to calculate your updated score.',
          [
            { text: 'Subscribe', onPress: () => router.push('/subscription') },
            { text: 'Later', style: 'cancel', onPress: () => router.replace('/you') },
          ]
        );
      } else {
        AppAlert.alert(
          'Profile Saved',
          'Your profile changes have been saved. Your score will be updated shortly in the background.',
          [{ text: 'OK', onPress: () => router.replace('/you') }]
        );
      }
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#5F4DB2" size="large" />
      </View>
    );
  }

  // 1. Scoring step (polls for the new score computed by the backend worker)
  if (step === 'scoring') {
    return (
      <ScoringScreen
        minComputedAt={confirmedAt}
        previousComputedAt={previousComputedAtRef.current}
        onReady={(score) => {
          setNewScore(score);
          setCandidateScore(score);
          if (score.value != null) {
            updateCandidateScore(score.value, score.band, score.computed_at);
          }
          refreshScore();
          setStep('score-reveal');
        }}
        onContinueWithoutScore={() => {
          refreshScore();
          AppAlert.alert(
            'Resume Saved',
            'Your updated resume is confirmed. Your score is being updated in the background.',
            [{ text: 'Return to Profile', onPress: () => router.replace('/you') }]
          );
        }}
      />
    );
  }

  // 2. Score reveal step (shows the updated score celebration and persists to AuthContext)
  if (step === 'score-reveal') {
    return (
      <ScoreRevealScreen
        mode="initial"
        score={newScore?.value ?? undefined}
        band={newScore?.band}
        onSave={() => {
          if (newScore?.value != null) {
            setCandidateScore(newScore);
            updateCandidateScore(newScore.value, newScore.band, newScore.computed_at);
          }
          refreshScore();
          router.replace('/you');
        }}
      />
    );
  }

  // 3. Career & Resume Details Editing Screen
  return (
    <CareerDetailsScreen
      versionId={versionId}
      onBack={() =>
        router.canGoBack() ? router.back() : router.replace('/you')
      }
      onDone={handleDone}
    />
  );
}
