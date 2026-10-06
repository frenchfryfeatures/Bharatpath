import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Image, Pressable, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { WarningCircle } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import {
  CandidateScoreResponse,
  getMyScore,
  scoringErrorMessage,
} from '@/services/api/scoring';

/**
 * Waits for a real score. Confirming a resume does not compute one - it emits
 * `resume.version_confirmed`, and a worker turns that into a score row. This
 * screen polls `GET /candidate/score/me` until it answers READY, and shows an
 * honest "still pending" state if it never does. It must never invent a number.
 *
 * Locally, nothing scores until all three of these are true:
 *   1. the outbox is being drained and a Celery worker is up -
 *      `PYTHON=.venv/bin/python bash backend/scripts/dev_workers.sh`
 *   2. Layer 1 extraction is enabled in `backend/.env`:
 *        SCORING_EXTRACTION_ENABLED=true
 *        SCORING_EXTRACTION_PROVIDER=openai
 *        SCORING_MODEL_ID=gpt-5.4-mini-2026-03-17
 *   3. `OPENAI_API_KEY` is set. There is no fallback extractor by design, so
 *      without a key the score stays PENDING rather than being guessed.
 *
 * Also note `confirmed_at` is a one-way latch: a confirmation whose event was
 * published with no worker running cannot be replayed. Confirm a new version.
 */
const STATUS_MESSAGES = [
  'Reading your resume',
  'Turning it into facts',
  'Computing your score',
];

const POLL_INTERVAL_MS = 2000;
// A real model call was measured at 8-16 seconds locally and may be slower
// under provider load. Keep polling for one minute, while the visible
// "Continue without score" action lets the candidate leave immediately.
const MAX_POLLS = 30;

interface ScoringScreenProps {
  onReady: (score: CandidateScoreResponse) => void;
  /** Move on with no score. The next screens show a dash, not a number. */
  onContinueWithoutScore?: () => void;
  /**
   * Minimum ISO timestamp for computed_at. Scores older than this were computed
   * for a previous resume version and must not be accepted.
   */
  minComputedAt?: string | null;
  /**
   * The previously known score row's computed_at.
   * If the API returns this identical timestamp, the background worker has not
   * completed scoring the new version yet.
   */
  previousComputedAt?: string | null;
}

export function ScoringScreen({
  onReady,
  onContinueWithoutScore,
  minComputedAt,
  previousComputedAt,
}: ScoringScreenProps) {
  const [statusIdx, setStatusIdx] = useState(0);
  const [pollCount, setPollCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const settledRef = useRef(false);

  useEffect(() => {
    const interval = setInterval(() => {
      setStatusIdx((prev) => (prev + 1) % STATUS_MESSAGES.length);
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  const checkOnce = useCallback(async (): Promise<boolean> => {
    if (settledRef.current) return true;
    try {
      const score = await getMyScore();
      if (score && score.status === 'READY' && score.value != null) {
        // GET /score/me continues returning the previous READY row while the
        // worker computes the newly confirmed resume. Never treat that old
        // row as the new result, even when its numeric value happens to differ
        // from locally cached state.
        const computedTime = score.computed_at
          ? new Date(score.computed_at).getTime()
          : Number.NaN;
        const confirmedTime = minComputedAt
          ? new Date(minComputedAt).getTime()
          : null;
        const isPreviousRow =
          previousComputedAt != null &&
          score.computed_at === previousComputedAt;
        const predatesConfirmation =
          confirmedTime != null &&
          (!Number.isFinite(computedTime) || computedTime < confirmedTime);

        if (isPreviousRow || predatesConfirmation) {
          return false;
        }

        // This is either the first score, or a row computed after the current
        // resume was confirmed. It is safe to display and cache.
        settledRef.current = true;
        setIsPolling(false);
        onReady(score);
        return true;
      }
      return false;
    } catch (err) {
      if (pollCount >= MAX_POLLS - 1) {
        throw err;
      }
      return false;
    }
  }, [minComputedAt, onReady, previousComputedAt, pollCount]);

  useEffect(() => {
    if (!isPolling || settledRef.current || error || pollCount >= MAX_POLLS) return;
    const timer = setTimeout(async () => {
      try {
        await checkOnce();
      } catch (err) {
        settledRef.current = true;
        setIsPolling(false);
        setError(scoringErrorMessage(err, 'Could not read your score.'));
        return;
      }
      setPollCount((count) => count + 1);
    }, pollCount === 0 ? 400 : POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [checkOnce, error, isPolling, pollCount]);

  useEffect(() => {
    if (pollCount >= MAX_POLLS && !settledRef.current) {
      setIsPolling(false);
      setError(
        'Your resume is saved and confirmed, but no score has been computed for it yet.'
      );
    }
  }, [pollCount]);

  const handleRetry = () => {
    settledRef.current = false;
    setError(null);
    setPollCount(0);
    setIsPolling(true);
  };

  const handleContinue = () => {
    settledRef.current = true;
    setIsPolling(false);
    onContinueWithoutScore?.();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" animated />
      <View style={styles.container}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.titleSection}>
            <Text style={styles.title}>Scoring your resume</Text>
            <Text style={styles.subtitle}>
              The number is computed after you confirm. This screen waits for it.
            </Text>
          </View>

          <View style={styles.heroSection}>
            <View style={styles.pillarsWrapper}>
              <Image
                source={require('../../assets/icons/pillars.png')}
                style={styles.pillarsImage}
                resizeMode="contain"
              />
            </View>

            <View style={styles.workingCard}>
              <Text style={styles.workingEyebrow}>{error ? 'NOT READY' : 'WORKING'}</Text>
              <View style={styles.statusTextWrapper}>
                <Text style={styles.statusText} numberOfLines={3}>
                  {error ? 'Score still pending' : STATUS_MESSAGES[statusIdx]}
                </Text>
              </View>

              {!error && (
                <View style={styles.progressSection}>
                  <View style={styles.progressTrack}>
                    <View
                      style={[
                        styles.progressFill,
                        { width: `${Math.min(92, 20 + pollCount * 12)}%` },
                      ]}
                    />
                  </View>
                </View>
              )}
            </View>
          </View>

          {error ? (
            <View style={styles.errorCard}>
              <WarningCircle size={22} color="#993A22" weight="fill" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : (
            <View style={styles.noteCard}>
              <Text style={styles.noteText}>
                Your resume is confirmed. This only waits for the number, and
                nothing you entered is lost if it takes longer.
              </Text>
            </View>
          )}
        </ScrollView>

        <View style={styles.bottomSection}>
          {error ? (
            <>
              <Pressable
                style={({ pressed }) => [styles.showScoreButton, pressed && styles.buttonPressed]}
                onPress={handleRetry}
                accessibilityRole="button"
              >
                <Text style={styles.showScoreButtonText}>Check again</Text>
              </Pressable>
              {onContinueWithoutScore && (
                <Pressable
                  style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]}
                  onPress={handleContinue}
                  accessibilityRole="button"
                >
                  <Text style={styles.ghostButtonText}>Continue without score</Text>
                </Pressable>
              )}
            </>
          ) : (
            <>
              <View style={styles.waitingButton}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.showScoreButtonText}>Computing your score</Text>
              </View>
              {onContinueWithoutScore && (
                <Pressable
                  style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]}
                  onPress={handleContinue}
                  accessibilityRole="button"
                >
                  <Text style={styles.ghostButtonText}>Continue without score</Text>
                </Pressable>
              )}
            </>
          )}

        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.offWhite,
  },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'space-between',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  titleSection: {
    gap: 4,
  },
  title: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.7,
    color: Colors.navy,
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: Colors.text.primary,
  },
  heroSection: {
    gap: Spacing.sm,
  },
  pillarsWrapper: {
    width: '100%',
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: -16,
  },
  pillarsImage: {
    width: '100%',
    height: '100%',
  },
  workingCard: {
    backgroundColor: Colors.indigo,
    borderRadius: Radii.cardLg,
    padding: Spacing.xl,
    gap: Spacing.base,
  },
  workingEyebrow: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 1.5,
    color: '#E0DBF4',
  },
  statusTextWrapper: {
    minHeight: 28,
    justifyContent: 'center',
  },
  statusText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 19,
    lineHeight: 26,
    letterSpacing: -0.4,
    color: '#FFFFFF',
  },
  progressSection: {
    gap: Spacing.sm,
  },
  progressTrack: {
    height: 6,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: Radii.pill,
    backgroundColor: '#FFFCF7',
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#F8E6E0',
    borderRadius: 20,
    padding: 16,
  },
  errorText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#993A22',
  },
  noteCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 16,
  },
  noteText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#3A4761',
  },
  bottomSection: {
    gap: 12,
    paddingBottom: 20,
    paddingTop: 8,
    backgroundColor: '#FFFCF7',
  },
  showScoreButton: {
    width: '100%',
    backgroundColor: '#5F4DB2',
    paddingVertical: 18,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButton: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
    paddingVertical: 16,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: '#0A1931',
  },
  waitingButton: {
    width: '100%',
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#5F4DB2',
    paddingVertical: 18,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  showScoreButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  privacyNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  privacyNoteText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
});
