/**
 * BharatPath - Resume Details Route
 * Displays all resume sections and details with full editing, new resume uploading,
 * and automated scoring recalculation flow.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { ArrowLeft } from 'phosphor-react-native';
import * as DocumentPicker from 'expo-document-picker';
import { ReviewDetailsScreen } from '@/screens/onboarding/ReviewDetailsScreen';
import { ParsingScreen } from '@/screens/onboarding/ParsingScreen';
import { ScoringScreen } from '@/screens/onboarding/ScoringScreen';
import { ScoreRevealScreen } from '@/screens/onboarding/ScoreRevealScreen';
import { SubscribeScreen } from '@/screens/subscription/SubscribeScreen';
import { PasteTextModal } from '@/screens/onboarding/PasteTextModal';
import { UploadedFileMeta, ResumeIntakePayload } from '@/screens/onboarding/ResumeIntakeScreen';
import { AppAlert } from '@/components/feedback/AppAlert';
import { useAuthContext } from '@/context/AuthContext';
import {
  listResumeVersions,
  getResumeVersionDetails,
  ResumeVersionDetailResponse,
} from '@/services/api/resume';
import { getMyScore, CandidateScoreResponse } from '@/services/api/scoring';
import { getCandidateSubscription } from '@/services/api/subscription';

type Step = 'review' | 'parsing' | 'scoring' | 'score-reveal' | 'subscribe';

export default function ResumeDetailsRoute() {
  const router = useRouter();
  const { session, candidateFullName, updateCandidateScore, setCandidateScore, candidateScore: authScore, refreshScore } = useAuthContext();

  const [step, setStep] = useState<Step>('review');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | undefined>();
  const [versionDetails, setVersionDetails] = useState<ResumeVersionDetailResponse | null>(null);

  // Upload/Parse state
  const [fileMeta, setFileMeta] = useState<UploadedFileMeta | undefined>();
  const [intakePayload, setIntakePayload] = useState<ResumeIntakePayload | undefined>();
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);

  // Subscription state
  const [hasSubscription, setHasSubscription] = useState<boolean | null>(null);
  const [pendingPostSubscribeAction, setPendingPostSubscribeAction] = useState<'scoring' | 'upload' | null>(null);

  const verifySubscription = async (): Promise<boolean> => {
    try {
      const sub = await getCandidateSubscription();
      const active = !!sub?.has_access;
      setHasSubscription(active);
      return active;
    } catch (err: any) {
      if (err?.status === 402 || err?.code === 'subscription_required') {
        setHasSubscription(false);
        return false;
      }
      return false;
    }
  };

  // Score recalculation state
  const [candidateScore, setLocalCandidateScore] = useState<CandidateScoreResponse | null>(authScore || null);
  const [confirmedAt, setConfirmedAt] = useState<string | null>(null);
  const previousComputedAtRef = React.useRef<string | null>(authScore?.computed_at || null);

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/you');
    }
  };

  // Check subscription status on mount
  useEffect(() => {
    getCandidateSubscription()
      .then((sub) => {
        setHasSubscription(!!sub?.has_access);
      })
      .catch(() => undefined);
  }, []);

  // Record candidate score at mount to distinguish old score from newly computed score
  useEffect(() => {
    let cancelled = false;
    getMyScore()
      .then((s) => {
        if (cancelled) return;
        if (s.status === 'READY') {
          previousComputedAtRef.current = s.computed_at;
          setLocalCandidateScore(s);
          setCandidateScore(s);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [setCandidateScore]);

  useEffect(() => {
    let cancelled = false;

    async function loadResume() {
      setIsLoading(true);
      setError(null);
      try {
        const versions = await listResumeVersions();
        if (cancelled) return;

        if (!versions || versions.length === 0) {
          setError('No resume found on your profile yet.');
          setIsLoading(false);
          return;
        }

        const preferred =
          versions.find((v) => v.confirmed && !v.superseded) ??
          versions.find((v) => v.confirmed) ??
          versions[0];

        const details = await getResumeVersionDetails(preferred.resume_version_id);
        if (cancelled) return;

        setVersionId(preferred.resume_version_id);
        setVersionDetails(details);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.message || 'Could not load your resume details.');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    loadResume();

    return () => {
      cancelled = true;
    };
  }, []);

  const handlePickDocument = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'text/plain',
        ],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const fileName = asset.name || 'Candidate_Resume.pdf';
        const fileSize = asset.size ? `${(asset.size / 1024).toFixed(0)} KB` : '412 KB';
        const fileSizeBytes = asset.size;
        const fileUri = asset.uri;
        const mimeType = asset.mimeType || 'application/pdf';

        if (fileName.toLowerCase().endsWith('.doc') || mimeType === 'application/msword') {
          AppAlert.alert(
            'Unsupported Format',
            'Old Word files are not supported. Save it as DOCX or PDF, or paste the text.'
          );
          return;
        }

        const meta: UploadedFileMeta = {
          fileName,
          fileSize,
          fileSizeBytes,
          fileUri,
          mimeType,
        };

        setFileMeta(meta);
        setIntakePayload({
          source: 'upload',
          fileMeta: meta,
        });
        setStep('parsing');
      }
    } catch (e) {
      console.warn('Document picker error:', e);
    }
  };

  const handlePasteSubmit = (text: string) => {
    setIsPasteModalOpen(false);
    const meta: UploadedFileMeta = {
      fileName: 'Pasted_Resume.txt',
      fileSize: `${text.length} chars`,
    };
    setFileMeta(meta);
    setIntakePayload({
      source: 'paste',
      fileMeta: meta,
      pastedText: text,
    });
    setStep('parsing');
  };

  const handleUploadNewPress = async () => {

    AppAlert.alert(
      'Upload New Resume',
      'Choose how you would like to provide your updated resume:',
      [
        { text: 'Choose file (PDF / DOCX)', style: 'default', onPress: handlePickDocument },
        { text: 'Paste resume text', style: 'secondary', onPress: () => setIsPasteModalOpen(true) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  };

  // Subscription Gate: Shown only when user has no active subscription when editing/updating score
  if (step === 'subscribe') {
    return (
      <SubscribeScreen
        candidateName={candidateFullName || undefined}
        onSubscribed={() => {
          setHasSubscription(true);
          if (pendingPostSubscribeAction === 'scoring') {
            setPendingPostSubscribeAction(null);
            setStep('scoring');
          } else if (pendingPostSubscribeAction === 'upload') {
            setPendingPostSubscribeAction(null);
            setStep('review');
            handlePickDocument();
          } else {
            setPendingPostSubscribeAction(null);
            setStep('review');
          }
        }}
        onSkip={() => {
          setHasSubscription(true);
          if (pendingPostSubscribeAction === 'scoring') {
            setPendingPostSubscribeAction(null);
            setStep('scoring');
          } else if (pendingPostSubscribeAction === 'upload') {
            setPendingPostSubscribeAction(null);
            setStep('review');
            handlePickDocument();
          } else {
            setPendingPostSubscribeAction(null);
            setStep('review');
          }
        }}
        onBack={() => {
          setPendingPostSubscribeAction(null);
          setStep('review');
        }}
      />
    );
  }

  // 1. Parsing Step (After selecting a new file or pasting)
  if (step === 'parsing') {
    return (
      <ParsingScreen
        fileMeta={fileMeta}
        payload={intakePayload}
        onReviewFound={(newVerId, newDetails) => {
          setVersionId(newVerId);
          setVersionDetails(newDetails);
          setError(null);
          setStep('review');
        }}
        onBack={() => setStep('review')}
      />
    );
  }

  // 2. Scoring Step (Polling backend score after confirming resume changes)
  if (step === 'scoring') {
    return (
      <ScoringScreen
        minComputedAt={confirmedAt}
        previousComputedAt={previousComputedAtRef.current}
        onReady={(score) => {
          setLocalCandidateScore(score);
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
            [{ text: 'Return to Profile', onPress: handleBack }]
          );
        }}
      />
    );
  }

  // 3. Score Reveal Step (Celebration & saving updated score)
  if (step === 'score-reveal') {
    return (
      <ScoreRevealScreen
        mode="initial"
        score={candidateScore?.value ?? undefined}
        band={candidateScore?.band}
        onSave={() => {
          if (candidateScore?.value != null) {
            setCandidateScore(candidateScore);
            updateCandidateScore(candidateScore.value, candidateScore.band, candidateScore.computed_at);
          }
          refreshScore();
          AppAlert.alert(
            'Score Updated',
            `Your score of ${candidateScore?.value ?? '—'} has been saved to your profile.`,
            [{ text: 'Return to Profile', onPress: handleBack }]
          );
        }}
      />
    );
  }

  // Initial loading
  if (isLoading) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <StatusBar style="dark" />
        <ActivityIndicator size="large" color="#5F4DB2" />
        <Text style={styles.loadingText}>Loading resume details...</Text>
      </SafeAreaView>
    );
  }

  // Initial error or empty state
  if (error || !versionId || !versionDetails) {
    return (
      <SafeAreaView style={styles.errorContainer}>
        <StatusBar style="dark" />
        <View style={styles.errorHeader}>
          <Pressable style={styles.backButton} onPress={handleBack}>
            <ArrowLeft size={18} color="#0A1931" weight="bold" />
          </Pressable>
          <Text style={styles.headerTitle}>Resume details</Text>
        </View>
        <View style={styles.errorContent}>
          <Text style={styles.errorText}>{error || 'Unable to load resume details.'}</Text>
          <Pressable style={styles.primaryButton} onPress={handleUploadNewPress}>
            <Text style={styles.primaryButtonText}>Upload a Resume</Text>
          </Pressable>
          <Pressable style={[styles.primaryButton, styles.secondaryButton]} onPress={handleBack}>
            <Text style={styles.secondaryButtonText}>Return to Profile</Text>
          </Pressable>
        </View>

        <PasteTextModal
          visible={isPasteModalOpen}
          onClose={() => setIsPasteModalOpen(false)}
          onSubmit={handlePasteSubmit}
        />
      </SafeAreaView>
    );
  }

  // 4. Default: Review & Edit Details Screen
  return (
    <>
      <ReviewDetailsScreen
        onBack={handleBack}
        title="Resume details"
        subtitle="Review and edit the details extracted from your resume."
        confirmButtonText="Save & update score"
        showReadyBadge={false}
        candidateName={candidateFullName || undefined}
        candidateEmail={session?.email}
        versionId={versionId}
        versionDetails={versionDetails}
        onUploadNewResume={handleUploadNewPress}
        onRequireSubscription={() => {
          setPendingPostSubscribeAction('scoring');
          setStep('subscribe');
        }}
        onVersionUpdated={(newVerId, newDetails) => {
          setVersionId(newVerId);
          setVersionDetails(newDetails);
        }}
        onConfirm={async (_confirmedVerId, confAt) => {
          setConfirmedAt(confAt || new Date().toISOString());

          const hasAccess = await verifySubscription();
          if (!hasAccess) {
            setPendingPostSubscribeAction('scoring');
            setStep('subscribe');
            return;
          }

          setStep('scoring');
        }}
      />

      <PasteTextModal
        visible={isPasteModalOpen}
        onClose={() => setIsPasteModalOpen(false)}
        onSubmit={handlePasteSubmit}
      />
    </>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F5EFE6',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 15,
    color: '#5F6B80',
  },
  errorContainer: {
    flex: 1,
    backgroundColor: '#F5EFE6',
  },
  errorHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 18,
    color: '#0A1931',
  },
  errorContent: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 16,
  },
  errorText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    color: '#3A4761',
    textAlign: 'center',
  },
  primaryButton: {
    backgroundColor: '#5F4DB2',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 999,
    width: '100%',
    maxWidth: 280,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  secondaryButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
  },
  secondaryButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    color: '#0A1931',
  },
});
