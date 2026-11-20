import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as FileSystem from 'expo-file-system/legacy';
import {
  ArrowLeft,
  CheckCircle,
  HardDrives,
  Microphone,
  SpeakerHigh,
  SpeakerSlash,
  WarningCircle,
  WifiHigh,
  Wind,
} from 'phosphor-react-native';
import { Radii } from '@/theme/tokens';
import { getBaseUrl } from '@/services/api/client';
import {
  DeviceCheckReadings,
  interviewErrorMessage,
  recordDeviceCheck,
  startInterviewSession,
} from '@/services/api/interview';

interface Props {
  onBack?: () => void;
}

type CheckState = {
  mic_ok: boolean | null;
  audio_out_ok: boolean | null;
  network_kbps: number | null;
  storage_mb: number | null;
  quiet_env_ok: boolean | null;
};

const initial: CheckState = {
  mic_ok: null,
  audio_out_ok: null,
  network_kbps: null,
  storage_mb: null,
  quiet_env_ok: null,
};

export function DeviceCheckScreen({ onBack }: Props) {
  const router = useRouter();
  const [checks, setChecks] = useState<CheckState>(initial);
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passed, setPassed] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const testConnection = async (): Promise<number | null> => {
    try {
      const start = Date.now();
      const response = await fetch(`${getBaseUrl()}/openapi.json?device_check=${start}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return null;
      const body = await response.arrayBuffer();
      const elapsedSeconds = Math.max((Date.now() - start) / 1000, 0.001);
      return Math.round((body.byteLength * 8) / 1000 / elapsedSeconds);
    } catch {
      return null;
    }
  };

  const readStorage = async (): Promise<number | null> => {
    try {
      if (Platform.OS === 'web') {
        const estimate = await navigator.storage?.estimate();
        if (estimate?.quota == null || estimate.usage == null) return null;
        return Math.floor((estimate.quota - estimate.usage) / 1024 / 1024);
      }
      return Math.floor((await FileSystem.getFreeDiskStorageAsync()) / 1024 / 1024);
    } catch {
      return null;
    }
  };

  const runAutomaticChecks = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const audio = await import('expo-audio');
      const permission = await audio.requestRecordingPermissionsAsync();
      const [network_kbps, storage_mb] = await Promise.all([testConnection(), readStorage()]);
      setChecks((current) => ({
        ...current,
        mic_ok: permission.granted,
        network_kbps,
        storage_mb,
      }));
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Could not run the device check.'));
    } finally {
      setRunning(false);
    }
  }, []);

  useEffect(() => {
    runAutomaticChecks();
  }, [runAutomaticChecks]);

  const submitCheck = async () => {
    const payload: DeviceCheckReadings = {
      mic_ok: checks.mic_ok === true,
      audio_out_ok: checks.audio_out_ok === true,
      network_kbps: checks.network_kbps,
      storage_mb: checks.storage_mb,
      quiet_env_ok: checks.quiet_env_ok === true,
    };
    setSubmitting(true);
    setError(null);
    try {
      const result = await recordDeviceCheck(payload);
      setPassed(result.passed);
      setFailures(result.failures);
      if (!result.passed) {
        setError('Fix the failed checks, then test again.');
      } else {
        await startInterview();
      }
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Could not save the device check.'));
    } finally {
      setSubmitting(false);
    }
  };

  const startInterview = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const session = await startInterviewSession();
      router.replace({
        pathname: '/interview-session',
        params: { sessionId: session.id },
      });
    } catch (caught) {
      const msg = interviewErrorMessage(
        caught,
        'The check passed, but the interview could not start.'
      );
      if (msg.toLowerCase().includes('buy') || msg.toLowerCase().includes('purchase')) {
        router.replace('/mock-interview');
        return;
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const back = () => {
    if (onBack) onBack();
    else if (router.canGoBack()) router.back();
    else router.replace('/mock-interview');
  };

  const allAnswered =
    checks.mic_ok !== null &&
    checks.audio_out_ok !== null &&
    checks.network_kbps !== null &&
    checks.storage_mb !== null &&
    checks.quiet_env_ok !== null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={back}>
          <ArrowLeft size={18} color="#0A1931" weight="bold" />
        </Pressable>
        <Text style={styles.headerTitle}>Device check</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Test before interview</Text>
        <Text style={styles.subtitle}>
          This interview is audio-only. A fresh passed check is required before recording.
        </Text>

        <View style={styles.list}>
          <CheckRow
            icon={<Microphone size={20} color="#0A1931" />}
            title="Microphone permission"
            value={checks.mic_ok == null ? 'Checking…' : checks.mic_ok ? 'Allowed' : 'Blocked'}
            passed={checks.mic_ok}
          />
          <CheckRow
            icon={checks.audio_out_ok === false
              ? <SpeakerSlash size={20} color="#0A1931" />
              : <SpeakerHigh size={20} color="#0A1931" />}
            title="Audio output"
            value="Can you hear audio on this device?"
            passed={checks.audio_out_ok}
            actions={
              <Choice
                yes={() => setChecks((value) => ({ ...value, audio_out_ok: true }))}
                no={() => setChecks((value) => ({ ...value, audio_out_ok: false }))}
              />
            }
          />
          <CheckRow
            icon={<WifiHigh size={20} color="#0A1931" />}
            title="Network"
            value={checks.network_kbps == null ? 'Could not measure' : `${checks.network_kbps} kbps`}
            passed={checks.network_kbps == null ? false : checks.network_kbps >= 16}
          />
          <CheckRow
            icon={<HardDrives size={20} color="#0A1931" />}
            title="Free storage"
            value={checks.storage_mb == null ? 'Could not measure' : `${checks.storage_mb} MB`}
            passed={checks.storage_mb == null ? false : checks.storage_mb >= 20}
          />
          <CheckRow
            icon={<Wind size={20} color="#0A1931" />}
            title="Quiet environment"
            value="Is background noise low enough to record?"
            passed={checks.quiet_env_ok}
            actions={
              <Choice
                yes={() => setChecks((value) => ({ ...value, quiet_env_ok: true }))}
                no={() => setChecks((value) => ({ ...value, quiet_env_ok: false }))}
              />
            }
          />
        </View>

        {failures.length > 0 && (
          <View style={styles.failureBox}>
            <WarningCircle size={20} color="#993A22" weight="fill" />
            <View style={styles.failureText}>
              {failures.map((code) => <Text key={code} style={styles.failureLine}>• {failureLabel(code)}</Text>)}
            </View>
          </View>
        )}
        {error && <Text style={styles.error}>{error}</Text>}

        {!passed ? (
          <>
            <Pressable style={styles.outline} onPress={runAutomaticChecks} disabled={running}>
              <Text style={styles.outlineText}>{running ? 'Testing…' : 'Test automatic checks again'}</Text>
            </Pressable>
            <Pressable
              style={[styles.primary, (!allAnswered || submitting) && styles.disabled]}
              onPress={submitCheck}
              disabled={!allAnswered || submitting}
            >
              {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Submit device check</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.passedBox}>
              <CheckCircle size={21} color="#1F6B45" weight="fill" />
              <Text style={styles.passedText}>Device check passed. Your interview is included in your subscription.</Text>
            </View>
            <Pressable
              style={[styles.primary, submitting && styles.disabled]}
              onPress={startInterview}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Start mock interview</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CheckRow({
  icon,
  title,
  value,
  passed,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  passed: boolean | null;
  actions?: React.ReactNode;
}) {
  return (
    <View style={styles.checkRow}>
      {icon}
      <View style={styles.checkCopy}>
        <Text style={styles.checkTitle}>{title}</Text>
        <Text style={styles.checkValue}>{value}</Text>
        {actions}
      </View>
      {passed === true ? (
        <CheckCircle size={21} color="#1F6B45" weight="fill" />
      ) : passed === false ? (
        <WarningCircle size={21} color="#993A22" weight="fill" />
      ) : (
        <ActivityIndicator size="small" color="#5F4DB2" />
      )}
    </View>
  );
}

function Choice({ yes, no }: { yes: () => void; no: () => void }) {
  return (
    <View style={styles.choices}>
      <Pressable style={styles.choice} onPress={yes}><Text style={styles.choiceText}>Yes</Text></Pressable>
      <Pressable style={styles.choice} onPress={no}><Text style={styles.choiceText}>No</Text></Pressable>
    </View>
  );
}

function failureLabel(code: string): string {
  return ({
    microphone_unavailable: 'Allow microphone access.',
    audio_output_unavailable: 'Confirm that this device can play audio.',
    network_too_slow: 'Connect to a working network.',
    storage_insufficient: 'Free at least 20 MB of storage.',
    environment_too_noisy: 'Move to a quieter place.',
  } as Record<string, string>)[code] || code;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFCF7' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10 },
  back: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#E7E0D4', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 16, color: '#0A1931' },
  content: { padding: 20, paddingTop: 12, paddingBottom: 36, gap: 14 },
  title: { fontFamily: 'GeneralSans-Semibold', fontSize: 27, color: '#0A1931' },
  subtitle: { fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 21, color: '#3A4761', marginBottom: 6 },
  list: { gap: 10 },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, borderRadius: 17, borderWidth: 1, borderColor: '#E7E0D4', backgroundColor: '#FFFFFF' },
  checkCopy: { flex: 1, gap: 4 },
  checkTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#0A1931' },
  checkValue: { fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 18, color: '#5F6B80' },
  choices: { flexDirection: 'row', gap: 8, marginTop: 7 },
  choice: { borderWidth: 1, borderColor: '#DDD6C7', borderRadius: Radii.pill, paddingHorizontal: 16, paddingVertical: 7 },
  choiceText: { fontFamily: 'GeneralSans-Semibold', fontSize: 12, color: '#0A1931' },
  failureBox: { flexDirection: 'row', gap: 10, padding: 15, borderRadius: 16, backgroundColor: '#FCEBE6' },
  failureText: { flex: 1, gap: 3 },
  failureLine: { fontFamily: 'GeneralSans-Regular', fontSize: 13, color: '#993A22' },
  error: { fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 19, color: '#993A22' },
  passedBox: { flexDirection: 'row', gap: 10, padding: 15, borderRadius: 16, backgroundColor: '#EAF5EE' },
  passedText: { flex: 1, fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 19, color: '#1F6B45' },
  outline: { alignItems: 'center', borderWidth: 1, borderColor: '#DDD6C7', borderRadius: Radii.pill, paddingVertical: 15 },
  outlineText: { fontFamily: 'GeneralSans-Semibold', fontSize: 14, color: '#0A1931' },
  primary: { alignItems: 'center', borderRadius: Radii.pill, paddingVertical: 17, backgroundColor: '#5F4DB2' },
  primaryText: { fontFamily: 'GeneralSans-Semibold', fontSize: 16, color: '#FFFFFF' },
  disabled: { opacity: 0.45 },
});
