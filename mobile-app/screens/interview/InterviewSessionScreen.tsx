import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppAlert } from "@/components/feedback/AppAlert";
import {
  ActivityIndicator,
  Alert,
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
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import type { AudioPlayer, RecordingOptions } from 'expo-audio';
import {
  ArrowLeft,
  ArrowCounterClockwise,
  CheckCircle,
  Lightbulb,
  Microphone,
  Pause,
  Play,
  Record,
  StopCircle,
  Timer,
  UploadSimple,
  WarningCircle,
} from 'phosphor-react-native';
import { Radii } from '@/theme/tokens';
import { ApiError } from '@/services/api/client';
import {
  InterviewQuestion,
  InterviewSession,
  completeInterviewAnswer,
  completeInterviewSession,
  getInterviewSession,
  getInterviewQuestionAudio,
  getNextInterviewQuestion,
  interviewErrorMessage,
  issueAnswerUpload,
  putInterviewAudio,
} from '@/services/api/interview';

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

/** The server rejects anything shorter, and deletes the audio when it does. */
const MIN_ANSWER_MS = 1000;

type Phase = 'loading' | 'prep' | 'recording' | 'review' | 'sending' | 'feedback' | 'finishing';

/**
 * Playback is for the candidate's own reassurance, so a player that refuses
 * must never fail the recording or the upload around it.
 *
 * The native player has no nullable source: `replace(null)` is rejected on
 * Android. Clearing a finished answer is therefore a pause and a rewind, and
 * the next recording replaces the source outright.
 */
function loadForPlayback(player: AudioPlayer, uri: string) {
  try {
    player.replace({ uri });
  } catch {
    // Reviewing the answer is optional; recording it is not.
  }
}

function stopPlayback(player: AudioPlayer) {
  try {
    player.pause();
    player.seekTo(0);
  } catch {
    // As above.
  }
}

interface Props {
  sessionId: string;
}

export function InterviewSessionScreen({ sessionId }: Props) {
  const router = useRouter();
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const recorderState = useAudioRecorderState(recorder, 200);
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);
  const questionPlayer = useAudioPlayer(null);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadingMessage, setLoadingMessage] = useState('Restoring your session…');
  const [isPreparingNext, setIsPreparingNext] = useState(false);
  const [prepLeft, setPrepLeft] = useState(0);
  const [localUri, setLocalUri] = useState<string | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [lookingFor, setLookingFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopping = useRef(false);

  const selectQuestion = useCallback((value: InterviewSession, targetIndex: number) => {
    setQuestionIndex(targetIndex);
    setPrepLeft(value.questions[targetIndex]?.preparation_seconds ?? 30);
    setPhase('prep');
  }, []);

  const load = useCallback(async () => {
    setError(null);
    setLoadingMessage('Restoring your session…');
    setPhase('loading');
    try {
      let value = await getInterviewSession(sessionId);
      if (['COMPLETED', 'EVALUATED', 'FAILED'].includes(value.state)) {
        router.replace({ pathname: '/interview-report', params: { sessionId } });
        return;
      }
      const firstUnstored = value.answers.findIndex((answer) => answer.upload_state !== 'STORED');
      if (firstUnstored < 0) {
        setSession(value);
        setQuestionIndex(Math.max(0, value.questions.length - 1));
        setPhase('finishing');
        return;
      }
      if (!value.questions[firstUnstored]) {
        setLoadingMessage('The interviewer is preparing your next question…');
        value = await getNextInterviewQuestion(sessionId);
      }
      setSession(value);
      selectQuestion(value, firstUnstored);
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Could not load this interview session.'));
      setPhase('loading');
    }
  }, [router, selectQuestion, sessionId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (phase !== 'prep' || prepLeft <= 0) return;
    const timer = setTimeout(() => setPrepLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [phase, prepLeft]);

  const question: InterviewQuestion | null = session?.questions[questionIndex] ?? null;
  const maxDurationMs = (question?.answer_seconds ?? 120) * 1000;

  // Read the question aloud as soon as it is on screen. Best effort: the
  // written question stays, so a failure here is silent.
  const promptIndex = question?.index ?? null;
  useEffect(() => {
    if (phase !== 'prep' || promptIndex === null) return;
    let cancelled = false;
    (async () => {
      try {
        const audio = await getInterviewQuestionAudio(sessionId, promptIndex);
        if (cancelled) return;
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
        if (cancelled) return;
        questionPlayer.replace({ uri: audio.url });
        questionPlayer.play();
      } catch {
        // The question is also written on screen.
      }
    })();
    return () => {
      cancelled = true;
      stopPlayback(questionPlayer);
    };
  }, [phase, promptIndex, questionPlayer, sessionId]);

  const stopRecording = useCallback(async () => {
    if (stopping.current || !recorderState.isRecording) return;
    stopping.current = true;
    try {
      const elapsed = recorderState.durationMillis;
      await recorder.stop();
      const uri = recorder.uri || recorder.getStatus().url;
      if (!uri) throw new Error('The recorder did not produce an audio file.');
      setDurationMs(Math.min(elapsed, maxDurationMs));
      setLocalUri(uri);
      loadForPlayback(player, uri);
      setPhase('review');
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Could not stop the recording.'));
      setPhase('prep');
    } finally {
      stopping.current = false;
    }
  }, [maxDurationMs, player, recorder, recorderState.durationMillis, recorderState.isRecording]);

  useEffect(() => {
    if (phase === 'recording' && recorderState.durationMillis >= maxDurationMs) {
      stopRecording();
    }
  }, [maxDurationMs, phase, recorderState.durationMillis, stopRecording]);

  const startRecording = async () => {
    setError(null);
    try {
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        shouldPlayInBackground: false,
      });
      await recorder.prepareToRecordAsync(VOICE_RECORDING);
      recorder.record({ forDuration: Math.ceil(maxDurationMs / 1000) });
      setPhase('recording');
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Microphone recording could not start.'));
    }
  };

  const togglePlayback = () => {
    if (playerStatus.playing) {
      stopPlayback(player);
      return;
    }
    try {
      player.play();
    } catch {
      // Reviewing the answer is optional; recording it is not.
    }
  };

  const retake = () => {
    stopPlayback(player);
    setLocalUri(null);
    setDurationMs(0);
    setPrepLeft(question?.preparation_seconds ?? 30);
    setPhase('prep');
  };

  const sendAnswer = async () => {
    if (!localUri || !question) return;
    if (durationMs < MIN_ANSWER_MS) {
      setError('That recording is too short to be an answer. Record it again.');
      return;
    }
    setPhase('sending');
    setError(null);
    try {
      const ticket = await issueAnswerUpload(sessionId, question.index);
      const mimeType = Platform.OS === 'web' ? 'audio/webm' : 'audio/mp4';
      await putInterviewAudio(ticket, localUri, mimeType);
      const stored = await completeInterviewAnswer(
        sessionId,
        question.index,
        Math.min(durationMs, ticket.max_duration_ms)
      );
      stopPlayback(player);
      setLookingFor(stored.looking_for);
      const refreshed = await getInterviewSession(sessionId);
      setSession(refreshed);
      setPhase('feedback');

      // Pre-generate next adaptive question in background while candidate reviews feedback
      const nextIdx = question.index + 1;
      if (nextIdx < 6) {
        getNextInterviewQuestion(sessionId)
          .then((updated) => setSession(updated))
          .catch((err) => console.log('Background next-question prefetch:', err));
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'interview_answer_already_stored') {
        const refreshed = await getInterviewSession(sessionId);
        setSession(refreshed);
        const nextIdx = refreshed.answers.findIndex((a) => a.upload_state !== 'STORED');
        if (nextIdx < 0) {
          setPhase('finishing');
        } else if (refreshed.questions[nextIdx]) {
          selectQuestion(refreshed, nextIdx);
        } else {
          load();
        }
        return;
      }
      setError(interviewErrorMessage(caught, 'Could not send this answer.'));
      setPhase('review');
    }
  };

  const nextQuestion = async () => {
    if (!session) return;
    setLocalUri(null);
    setDurationMs(0);
    setLookingFor(null);
    stopPlayback(player);

    const storedCount = session.answers.filter((answer) => answer.upload_state === 'STORED').length;
    if (storedCount >= 6) {
      finish();
      return;
    }

    if (session.questions[storedCount]) {
      selectQuestion(session, storedCount);
      return;
    }

    setIsPreparingNext(true);
    setLoadingMessage('The interviewer is preparing your next question…');
    setPhase('loading');
    try {
      const updated = await getNextInterviewQuestion(sessionId);
      setSession(updated);
      if (updated.questions[storedCount]) {
        selectQuestion(updated, storedCount);
      } else {
        selectQuestion(updated, updated.questions.length - 1);
      }
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Could not load the next question.'));
      setPhase('feedback');
    } finally {
      setIsPreparingNext(false);
    }
  };

  const finish = async () => {
    setPhase('finishing');
    setError(null);
    try {
      await completeInterviewSession(sessionId);
      router.replace({ pathname: '/interview-report', params: { sessionId } });
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Could not finish this session.'));
      const refreshed = await getInterviewSession(sessionId);
      setSession(refreshed);
    }
  };

  useEffect(() => {
    if (phase === 'finishing' && session?.answers.every((answer) => answer.upload_state === 'STORED')) {
      finish();
    }
    // `finish` deliberately runs once when the manifest reaches all-STORED.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, session]);

  const leave = () => {
    AppAlert.alert(
      'Leave this interview?',
      'Stored answers are safe. Your current unsent recording stays only on this device and may be lost.',
      [
        { text: 'Stay', style: 'cancel' },
        { text: 'Leave', onPress: () => router.replace('/home') },
      ]
    );
  };

  const storedCount = session?.answers.filter((answer) => answer.upload_state === 'STORED').length ?? 0;
  const time = useMemo(() => formatTime(recorderState.durationMillis), [recorderState.durationMillis]);

  if (phase === 'loading' || !session || !question) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          {error ? (
            <>
              <WarningCircle size={28} color="#993A22" weight="fill" />
              <Text style={styles.error}>{error}</Text>
              <Pressable style={styles.primary} onPress={load}><Text style={styles.primaryText}>Try again</Text></Pressable>
            </>
          ) : (
            <>
              <ActivityIndicator color="#5F4DB2" size="large" />
              <Text style={styles.muted}>{loadingMessage}</Text>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'recording') {
    return (
      <SafeAreaView style={styles.recordingSafe}>
        <View style={styles.recording}>
          <View style={styles.topRow}>
            <Text style={styles.recordingEyebrow}>QUESTION {questionIndex + 1} OF {session.answers.length || 6}</Text>
            <Text style={styles.recordingTimer}>{time}</Text>
          </View>
          <Text style={styles.recordingPrompt}>{formatQuestionPrompt(question.prompt)}</Text>
          <View style={styles.micCircle}><Microphone size={48} color="#5F4DB2" weight="fill" /></View>
          <Text style={styles.recordingHint}>
            Recording · maximum {formatTime(maxDurationMs)}
          </Text>
          <Pressable style={styles.stopButton} onPress={stopRecording}>
            <StopCircle size={20} color="#0A1931" weight="fill" />
            <Text style={styles.stopText}>Stop recording</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'review' || phase === 'sending') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.page}>
          <Text style={styles.eyebrow}>ANSWER {questionIndex + 1} RECORDED</Text>
          <Text style={styles.title}>Keep this answer?</Text>
          <Text style={styles.subtitle}>Listen before sending. Retake discards only this local recording.</Text>
          <View style={styles.playback}>
            <Pressable
              style={styles.playButton}
              onPress={togglePlayback}
            >
              {playerStatus.playing ? <Pause size={22} color="#FFFFFF" weight="fill" /> : <Play size={22} color="#FFFFFF" weight="fill" />}
            </Pressable>
            <View style={styles.playbackCopy}>
              <Text style={styles.playbackTitle}>Answer {questionIndex + 1}</Text>
              <Text style={styles.muted}>{formatTime(durationMs)} · stored after you send it</Text>
            </View>
          </View>
          {error && <Text style={styles.error}>{error}</Text>}
          <View style={styles.bottom}>
            <Pressable style={[styles.primary, phase === 'sending' && styles.disabled]} onPress={sendAnswer} disabled={phase === 'sending'}>
              {phase === 'sending' ? <ActivityIndicator color="#FFFFFF" /> : <><UploadSimple size={18} color="#FFFFFF" /><Text style={styles.primaryText}>Keep and send answer</Text></>}
            </Pressable>
            <Pressable style={styles.outline} onPress={retake} disabled={phase === 'sending'}>
              <ArrowCounterClockwise size={18} color="#0A1931" />
              <Text style={styles.outlineText}>Record again</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'feedback') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.page}>
          <CheckCircle size={42} color="#1F6B45" weight="fill" />
          <Text style={styles.title}>Answer stored</Text>
          <Text style={styles.subtitle}>Your recording reached the server safely.</Text>
          {lookingFor && (
            <View style={styles.feedback}>
              <View style={styles.feedbackHeader}>
                <Lightbulb size={18} color="#5F4DB2" weight="fill" />
                <Text style={styles.feedbackLabel}>WHAT A GOOD ANSWER CONTAINS</Text>
              </View>
              <Text style={styles.feedbackText}>{lookingFor}</Text>
            </View>
          )}
          <View style={styles.bottom}>
            <Pressable
              style={[styles.primary, isPreparingNext && styles.disabled]}
              onPress={nextQuestion}
              disabled={isPreparingNext}
            >
              {isPreparingNext ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.primaryText}>
                  {storedCount >= 6 ? 'Finish session' : 'Next question'}
                </Text>
              )}
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (phase === 'finishing') {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#5F4DB2" />
          <Text style={styles.title}>Finishing your session</Text>
          <Text style={styles.subtitle}>All six answers must be confirmed by the server.</Text>
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.page}>
        <View style={styles.topRow}>
          <Pressable onPress={leave}><ArrowLeft size={21} color="#0A1931" weight="bold" /></Pressable>
          <Text style={styles.eyebrow}>QUESTION {questionIndex + 1} OF {session.answers.length || 6}</Text>
          <View style={styles.timerBadge}><Timer size={15} color="#0A1931" /><Text style={styles.timerText}>0:{String(prepLeft).padStart(2, '0')}</Text></View>
        </View>
        <View style={styles.segments}>
          {session.answers.map((answer) => (
            <View key={answer.question_index} style={[styles.segment, answer.upload_state === 'STORED' || answer.question_index === questionIndex ? styles.segmentDone : styles.segmentOpen]} />
          ))}
        </View>
        <ScrollView contentContainerStyle={styles.questionContent}>
          <Text style={styles.prompt}>{formatQuestionPrompt(question.prompt)}</Text>
          <View style={styles.durationBox}>
            <Microphone size={20} color="#5F4DB2" />
            <Text style={styles.durationText}>
              You can answer for up to {Math.round(question.answer_seconds / 60)} minutes. Recording starts only when you tap.
            </Text>
          </View>
          <Text style={styles.noTips}>
            Guidance is shown only after your answer is stored.
          </Text>
          {error && <Text style={styles.error}>{error}</Text>}
        </ScrollView>
        <Pressable style={styles.primary} onPress={startRecording}>
          <Record size={19} color="#FFFFFF" weight="fill" />
          <Text style={styles.primaryText}>Start recording</Text>
        </Pressable>
      </View>
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
  safe: { flex: 1, backgroundColor: '#FFFCF7' },
  recordingSafe: { flex: 1, backgroundColor: '#5F4DB2' },
  page: { flex: 1, padding: 20, gap: 16 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  eyebrow: { fontFamily: 'GeneralSans-Bold', fontSize: 11, letterSpacing: 1.1, color: '#0A1931' },
  timerBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radii.pill, backgroundColor: '#F0EBDF' },
  timerText: { fontFamily: 'GeneralSans-Bold', fontSize: 12, color: '#0A1931' },
  segments: { flexDirection: 'row', gap: 4 },
  segment: { flex: 1, height: 4, borderRadius: 4 },
  segmentDone: { backgroundColor: '#5F4DB2' },
  segmentOpen: { backgroundColor: '#E7E0D4' },
  questionContent: { flexGrow: 1, gap: 20, paddingTop: 18 },
  prompt: { fontFamily: 'GeneralSans-Bold', fontSize: 28, lineHeight: 36, color: '#0A1931' },
  durationBox: { flexDirection: 'row', gap: 12, padding: 16, borderRadius: 17, backgroundColor: '#F2EFFB' },
  durationText: { flex: 1, fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 20, color: '#3A4761' },
  noTips: { fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 19, color: '#5F6B80' },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 18, paddingHorizontal: 20, borderRadius: Radii.pill, backgroundColor: '#5F4DB2' },
  primaryText: { fontFamily: 'GeneralSans-Semibold', fontSize: 16, color: '#FFFFFF' },
  disabled: { opacity: 0.5 },
  outline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: Radii.pill, borderWidth: 1, borderColor: '#DDD6C7' },
  outlineText: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#0A1931' },
  recording: { flex: 1, padding: 20, alignItems: 'center', gap: 22 },
  recordingEyebrow: { fontFamily: 'GeneralSans-Bold', fontSize: 11, letterSpacing: 1.1, color: '#FFFFFF' },
  recordingTimer: { fontFamily: 'SpaceMono-Bold', fontSize: 13, color: '#FFFFFF', backgroundColor: '#B23A1E', paddingHorizontal: 12, paddingVertical: 6, borderRadius: Radii.pill },
  recordingPrompt: { alignSelf: 'stretch', fontFamily: 'GeneralSans-Semibold', fontSize: 19, lineHeight: 27, color: '#FFFFFF' },
  micCircle: { width: 124, height: 124, borderRadius: 62, marginTop: 'auto', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  recordingHint: { fontFamily: 'GeneralSans-Regular', fontSize: 13, color: '#FFFFFF', opacity: 0.88 },
  stopButton: { alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 'auto', paddingVertical: 18, borderRadius: Radii.pill, backgroundColor: '#FFFFFF' },
  stopText: { fontFamily: 'GeneralSans-Semibold', fontSize: 16, color: '#0A1931' },
  title: { fontFamily: 'GeneralSans-Bold', fontSize: 28, lineHeight: 34, color: '#0A1931' },
  subtitle: { fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 21, color: '#3A4761' },
  playback: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 17, borderRadius: 20, borderWidth: 1, borderColor: '#E7E0D4', backgroundColor: '#FFFFFF' },
  playButton: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5F4DB2' },
  playbackCopy: { flex: 1, gap: 5 },
  playbackTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#0A1931' },
  muted: { fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 19, color: '#5F6B80' },
  bottom: { marginTop: 'auto', gap: 10 },
  error: { fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 19, color: '#993A22', textAlign: 'center' },
  feedback: { padding: 18, borderRadius: 20, borderWidth: 1, borderColor: '#D9D2F2', backgroundColor: '#F2EFFB', gap: 12 },
  feedbackHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  feedbackLabel: { fontFamily: 'GeneralSans-Bold', fontSize: 11, letterSpacing: 1, color: '#5F4DB2' },
  feedbackText: { fontFamily: 'GeneralSans-Regular', fontSize: 15, lineHeight: 22, color: '#26344D' },
});
