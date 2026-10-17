import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  AudioQuality,
  IOSOutputFormat,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import type { RecordingOptions } from 'expo-audio';
import {
  ArrowLeft,
  ArrowCounterClockwise,
  CheckCircle,
  Clock,
  Microphone,
  Square,
  Sparkle,
  UploadSimple,
  WarningCircle,
} from 'phosphor-react-native';
import { AppAlert } from '@/components/feedback/AppAlert';
import { Radii } from '@/theme/tokens';
import {
  InterviewQuestion,
  InterviewSession,
  completeInterviewAnswer,
  completeInterviewSession,
  getInterviewSession,
  getNextInterviewQuestion,
  interviewErrorMessage,
  issueAnswerUpload,
  putInterviewAudio,
} from '@/services/api/interview';
import { QuestionAudioPlayer } from '@/components/interview/QuestionAudioPlayer';
import { StudentAudioPlayer } from '@/components/interview/StudentAudioPlayer';

const VOICE_RECORDING: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 32000,
  isMeteringEnabled: true,
  android: {
    extension: '.m4a',
    outputFormat: 'mpeg4',
    audioEncoder: 'aac',
    sampleRate: 16000,
  },
  ios: {
    extension: '.m4a',
    sampleRate: 16000,
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.MEDIUM,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 32000,
  },
};

const MIN_ANSWER_MS = 1000;

interface Props {
  sessionId: string;
}

export function InterviewSessionScreen({ sessionId }: Props) {
  const router = useRouter();
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const recorderState = useAudioRecorderState(recorder, 200);

  const [session, setSession] = useState<InterviewSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saveStage, setSaveStage] = useState<'saving' | 'preparing'>('saving');
  const [clipUri, setClipUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);

  // Pulse animation for recording ring
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const startedAt = useRef(0);
  const stopping = useRef(false);

  useEffect(() => {
    let loop: Animated.CompositeAnimation | null = null;
    if (recorderState.isRecording) {
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.25,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1.0,
            duration: 800,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ])
      );
      loop.start();
    } else {
      pulseAnim.setValue(1);
    }
    return () => loop?.stop();
  }, [pulseAnim, recorderState.isRecording]);

  const fetchSession = useCallback(async () => {
    setError(null);
    try {
      const data = await getInterviewSession(sessionId);
      if (['COMPLETED', 'EVALUATED'].includes(data.state)) {
        router.replace({ pathname: '/interview-report', params: { sessionId } });
        return;
      }
      setSession(data);
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Could not load this interview session.'));
    } finally {
      setLoading(false);
    }
  }, [router, sessionId]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  // Current question is the first question without a STORED answer
  const current: InterviewQuestion | null = useMemo(() => {
    if (!session) return null;
    return (
      session.questions.find((q) => {
        const ans = session.answers.find((a) => a.question_index === q.index);
        return ans?.upload_state !== 'STORED';
      }) ?? null
    );
  }, [session]);

  const savedCount = useMemo(() => {
    if (!session) return 0;
    return session.questions.filter((q) => {
      const ans = session.answers.find((a) => a.question_index === q.index);
      return ans?.upload_state === 'STORED';
    }).length;
  }, [session]);

  const totalQuestions = session?.questions_total ?? session?.questions.length ?? 6;
  const allStored = useMemo(() => {
    if (!session || !session.answers.length) return false;
    return session.answers.length >= totalQuestions && session.answers.every((a) => a.upload_state === 'STORED');
  }, [session, totalQuestions]);

  const isDone = session?.state === 'COMPLETED' || session?.state === 'EVALUATED';
  const maxDurationMs = (current?.answer_seconds ?? 120) * 1000;

  // Recording controls
  const record = async () => {
    setError(null);
    setClipUri(null);
    setDurationMs(0);
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      await recorder.prepareToRecordAsync(VOICE_RECORDING);
      startedAt.current = Date.now();
      recorder.record({ forDuration: Math.ceil(maxDurationMs / 1000) });
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Microphone permission or recording is not available.'));
    }
  };

  const stop = useCallback(async () => {
    if (stopping.current || !recorderState.isRecording) return;
    stopping.current = true;
    try {
      const elapsed = Date.now() - startedAt.current;
      await recorder.stop();
      const uri = recorder.uri || recorder.getStatus().url;
      if (!uri) throw new Error('No audio recording was created.');

      // Reset audio mode for normal playback
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      });

      setDurationMs(Math.min(elapsed, maxDurationMs));
      setClipUri(uri);
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Could not stop recording.'));
    } finally {
      stopping.current = false;
    }
  }, [maxDurationMs, recorder, recorderState.isRecording]);

  // Auto-stop when max duration reached
  useEffect(() => {
    if (recorderState.isRecording && recorderState.durationMillis >= maxDurationMs) {
      stop();
    }
  }, [maxDurationMs, recorderState.durationMillis, recorderState.isRecording, stop]);

  // Retake recording
  const retake = () => {
    setClipUri(null);
    setDurationMs(0);
    setError(null);
  };

  // Upload and send answer
  const send = async () => {
    if (!clipUri || !current || busy) return;
    if (durationMs < MIN_ANSWER_MS) {
      setError('Recording is too short to be an answer. Please record again.');
      return;
    }

    setBusy(true);
    setSaveStage('saving');
    setError(null);

    try {
      const ticket = await issueAnswerUpload(sessionId, current.index);
      if (durationMs > ticket.max_duration_ms) {
        throw new Error('Recording length exceeds the limit. Please record a shorter answer.');
      }

      const mimeType = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
      await putInterviewAudio(ticket, clipUri, mimeType);

      await completeInterviewAnswer(sessionId, current.index, durationMs);
      setClipUri(null);
      setDurationMs(0);

      // If more questions are expected, request the next question from AI
      if (current.index + 1 < totalQuestions) {
        setSaveStage('preparing');
        await getNextInterviewQuestion(sessionId);
      }

      // Refresh session state to show next question or finish
      await fetchSession();
    } catch (cause) {
      setError(interviewErrorMessage(cause, 'Could not save the answer. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  // Complete interview session
  const finish = async () => {
    setError(null);
    setFinishing(true);
    try {
      await completeInterviewSession(sessionId);
      router.replace({ pathname: '/interview-report', params: { sessionId } });
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Could not finish the interview. Please try again.'));
      await fetchSession();
    } finally {
      setFinishing(false);
    }
  };

  const handleLeave = () => {
    AppAlert.alert(
      'Leave this interview?',
      'Stored answers are safe. Your current unsent recording stays only on this device.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', onPress: () => router.replace('/home') },
      ]
    );
  };

  const progressPercent = totalQuestions > 0 ? (savedCount / totalQuestions) * 100 : 0;
  const timeFormatted = formatTime(recorderState.durationMillis);

  return (
    <SafeAreaView style={styles.safe}>
      {/* Header bar */}
      <View style={styles.header}>
        <Pressable onPress={handleLeave} style={styles.backBtn} accessibilityLabel="Back">
          <ArrowLeft size={20} color="#0A1931" weight="bold" />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerEyebrow}>
            {current ? `QUESTION ${current.index + 1} OF ${totalQuestions}` : 'MOCK INTERVIEW'}
          </Text>
          <Text style={styles.headerSubtitle}>
            {savedCount} of {totalQuestions} answers saved
          </Text>
        </View>
        <View style={styles.headerRightSpacer} />
      </View>

      {/* Progress meter bar */}
      <View style={styles.meterContainer}>
        <View style={[styles.meterFill, { width: `${progressPercent}%` }]} />
      </View>

      {/* Main Content Area */}
      {busy ? (
        <View style={styles.centerContainer}>
          <View style={styles.spinnerCircle}>
            <ActivityIndicator size="large" color="#5F4DB2" />
          </View>
          <Text style={styles.busyTitle}>
            {saveStage === 'saving' ? 'Saving your answer…' : 'Preparing your next question…'}
          </Text>
          <Text style={styles.busySubtitle}>
            {saveStage === 'saving'
              ? 'Uploading recording to storage securely.'
              : 'The AI interviewer is listening and drafting your next question.'}
          </Text>
          <Text style={styles.busyMuted}>Please keep this screen open. This may take a few moments.</Text>
        </View>
      ) : loading ? (
        <View style={styles.centerContainer}>
          <ActivityIndicator size="large" color="#5F4DB2" />
          <Text style={styles.loadingText}>Loading your interview session…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {current ? (
            <View style={styles.card}>
              {/* Question text */}
              <Text style={styles.questionPrompt}>{formatQuestionPrompt(current.prompt)}</Text>

              {/* Question Audio with auto-fetch and autoplay */}
              <QuestionAudioPlayer
                key={`${sessionId}-${current.index}`}
                sessionId={sessionId}
                index={current.index}
              />

              {/* Status chips */}
              <View style={styles.chipRow}>
                <View style={styles.chipNeutral}>
                  <Clock size={12} color="#5F6B80" weight="bold" />
                  <Text style={styles.chipTextNeutral}>{current.preparation_seconds}s to prepare</Text>
                </View>
                <View style={styles.chipWaiting}>
                  <Microphone size={12} color="#5F4DB2" weight="bold" />
                  <Text style={styles.chipTextWaiting}>Up to {current.answer_seconds}s to answer</Text>
                </View>
              </View>

              {/* Recording Box */}
              <View style={styles.recordingBox}>
                {recorderState.isRecording ? (
                  <>
                    <View style={styles.pulsingMicWrapper}>
                      <Animated.View
                        style={[
                          styles.pulsingMicHalo,
                          { transform: [{ scale: pulseAnim }] },
                        ]}
                      />
                      <View style={styles.pulsingMicCore}>
                        <Microphone size={24} color="#FFFFFF" weight="fill" />
                      </View>
                    </View>

                    <Text style={styles.recordingStatusTitle}>Recording in progress. Speak clearly.</Text>
                    <Text style={styles.recordingTimerText}>
                      {timeFormatted} / {formatTime(maxDurationMs)}
                    </Text>

                    <Pressable
                      style={({ pressed }) => [styles.stopBtn, pressed && styles.btnPressed]}
                      onPress={stop}
                    >
                      <Square size={14} color="#0A1931" weight="fill" />
                      <Text style={styles.stopBtnText}>Stop recording</Text>
                    </Pressable>
                  </>
                ) : (
                  <>
                    <View style={styles.idleMicCircle}>
                      <Microphone size={24} color="#5F4DB2" weight="fill" />
                    </View>
                    <Text style={styles.recordingHint}>
                      {clipUri ? 'Happy with it? Save, or record again.' : 'Press record when you are ready.'}
                    </Text>

                    {!clipUri && (
                      <Pressable
                        style={({ pressed }) => [styles.primaryBtn, pressed && styles.btnPressed]}
                        onPress={record}
                        disabled={busy}
                      >
                        <Microphone size={18} color="#FFFFFF" weight="fill" />
                        <Text style={styles.primaryBtnText}>Record answer</Text>
                      </Pressable>
                    )}
                  </>
                )}
              </View>

              {/* Recorded Audio Review & Actions */}
              {clipUri && !recorderState.isRecording && (
                <View style={styles.reviewSection}>
                  <StudentAudioPlayer src={clipUri} knownDurationMs={durationMs} label="your answer" />

                  <View style={styles.actionButtonsRow}>
                    <Pressable
                      style={({ pressed }) => [styles.outlineBtn, pressed && styles.btnPressed]}
                      onPress={retake}
                      disabled={busy}
                    >
                      <ArrowCounterClockwise size={16} color="#0A1931" weight="bold" />
                      <Text style={styles.outlineBtnText}>Record again</Text>
                    </Pressable>

                    <Pressable
                      style={({ pressed }) => [
                        styles.primaryBtn,
                        styles.flex1,
                        pressed && styles.btnPressed,
                      ]}
                      onPress={send}
                      disabled={busy}
                    >
                      <UploadSimple size={18} color="#FFFFFF" weight="bold" />
                      <Text style={styles.primaryBtnText}>Save answer & continue</Text>
                    </Pressable>
                  </View>
                </View>
              )}
            </View>
          ) : isDone ? (
            <View style={[styles.card, styles.centerCard]}>
              <CheckCircle size={44} color="#1F6B45" weight="fill" />
              <Text style={styles.doneTitle}>Interview completed</Text>
              <Text style={styles.doneSubtitle}>
                Nice work. Your performance report and feedback appear in your interview history.
              </Text>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, styles.mt16, pressed && styles.btnPressed]}
                onPress={() => router.replace({ pathname: '/interview-report', params: { sessionId } })}
              >
                <Text style={styles.primaryBtnText}>View interview report</Text>
              </Pressable>
            </View>
          ) : allStored ? (
            <View style={[styles.card, styles.centerCard]}>
              <CheckCircle size={44} color="#5F4DB2" weight="fill" />
              <Text style={styles.doneTitle}>All answers saved</Text>
              <Text style={styles.doneSubtitle}>Finish to complete the session and submit for evaluation.</Text>
              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  styles.mt16,
                  finishing && styles.disabled,
                  pressed && styles.btnPressed,
                ]}
                onPress={finish}
                disabled={finishing}
              >
                {finishing ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.primaryBtnText}>Finish interview</Text>
                )}
              </Pressable>
            </View>
          ) : (
            <View style={[styles.card, styles.centerCard]}>
              <Sparkle size={36} color="#5F4DB2" weight="fill" />
              <Text style={styles.doneTitle}>Your next question is ready</Text>
              <Text style={styles.doneSubtitle}>Tap below to retrieve the next adaptive question from the AI interviewer.</Text>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, styles.mt16, pressed && styles.btnPressed]}
                onPress={async () => {
                  try {
                    setLoading(true);
                    await getNextInterviewQuestion(sessionId);
                    await fetchSession();
                  } catch (err) {
                    setError('Could not prepare the next question. Please retry.');
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <Text style={styles.primaryBtnText}>Get next question</Text>
              </Pressable>
            </View>
          )}

          {/* Error Banner */}
          {error && (
            <View style={styles.errorBanner}>
              <WarningCircle size={18} color="#993A22" weight="fill" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export function formatQuestionPrompt(raw: string): string {
  if (!raw) return '';
  const cleaned = raw.replace(/^Stub question \d+ \([a-f0-9]+\):\s*/i, '').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function formatTime(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFCF7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    alignItems: 'center',
  },
  headerEyebrow: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0A1931',
    letterSpacing: 0.8,
  },
  headerSubtitle: {
    fontSize: 11,
    color: '#5F6B80',
    fontWeight: '500',
    marginTop: 2,
  },
  headerRightSpacer: {
    width: 38,
  },
  meterContainer: {
    height: 5,
    backgroundColor: '#EBE5D8',
    width: '100%',
  },
  meterFill: {
    height: '100%',
    backgroundColor: '#5F4DB2',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
    gap: 14,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: '#EBE5D8',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  centerCard: {
    alignItems: 'center',
    paddingVertical: 32,
    paddingHorizontal: 20,
    textAlign: 'center',
  },
  questionPrompt: {
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 28,
    color: '#0A1931',
    letterSpacing: -0.3,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  chipNeutral: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1EFE9',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
  },
  chipTextNeutral: {
    fontSize: 11,
    fontWeight: '600',
    color: '#5F6B80',
  },
  chipWaiting: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F2EFFB',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
  },
  chipTextWaiting: {
    fontSize: 11,
    fontWeight: '600',
    color: '#5F4DB2',
  },
  recordingBox: {
    marginTop: 20,
    backgroundColor: '#F7F4EC',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 24,
    alignItems: 'center',
    gap: 12,
  },
  idleMicCircle: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  pulsingMicWrapper: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulsingMicHalo: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(239, 68, 68, 0.25)',
  },
  pulsingMicCore: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#DC2626',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordingStatusTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0A1931',
  },
  recordingTimerText: {
    fontSize: 13,
    fontFamily: 'SpaceMono-Bold',
    color: '#DC2626',
  },
  recordingHint: {
    fontSize: 13,
    color: '#5F6B80',
    textAlign: 'center',
    fontWeight: '500',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#5F4DB2',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: Radii.pill,
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 3,
  },
  primaryBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  stopBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: Radii.pill,
    marginTop: 4,
  },
  stopBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0A1931',
  },
  reviewSection: {
    marginTop: 16,
    gap: 14,
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  outlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: Radii.pill,
  },
  outlineBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0A1931',
  },
  flex1: {
    flex: 1,
  },
  btnPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.97 }],
  },
  disabled: {
    opacity: 0.55,
  },
  mt16: {
    marginTop: 16,
  },
  centerContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  spinnerCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F1EAF7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  busyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0A1931',
    textAlign: 'center',
  },
  busySubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: '#3A4761',
    textAlign: 'center',
  },
  busyMuted: {
    fontSize: 12,
    color: '#5F6B80',
    textAlign: 'center',
    marginTop: 4,
  },
  loadingText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5F6B80',
    marginTop: 8,
  },
  doneTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0A1931',
    marginTop: 10,
    textAlign: 'center',
  },
  doneSubtitle: {
    fontSize: 13,
    lineHeight: 19,
    color: '#5F6B80',
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 10,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FDF2F0',
    borderWidth: 1,
    borderColor: '#F8D7D2',
    padding: 12,
    borderRadius: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '500',
    color: '#993A22',
  },
});
