/**
 * BharatPath - Interview Sessions List Screen
 *
 * Lists the candidate's past mock interview sessions from
 * `GET /candidate/interview/sessions` (newest first) and lets them open the
 * feedback report for any completed/evaluated one.
 *
 * Backend contract (`backend/app/modules/interview/schemas.py`):
 *   - `SessionSummary`: id, session_number, state, question_set_code,
 *     created_at, completed_at
 *   - `state`: CREATED | IN_PROGRESS | COMPLETED | EVALUATED | ABANDONED | FAILED
 *
 * Only COMPLETED and EVALUATED sessions have a report to read. IN_PROGRESS
 * sessions can be resumed (the offer screen already handles the open one).
 * ABANDONED/FAILED/CREATED are shown greyed out and not tappable.
 *
 * The score is never shown here (invariant: the report carries no number about
 * the candidate). Each row shows the session number, date, and a status pill.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  CaretRight,
  CheckCircle,
  Clock,
  MicrophoneStage,
  WarningCircle,
} from 'phosphor-react-native';
import { Radii } from '@/theme/tokens';
import {
  InterviewSessionSummary,
  interviewErrorMessage,
  listInterviewSessions,
} from '@/services/api/interview';

interface Props {
  onBack?: () => void;
}

export function InterviewSessionsScreen({ onBack }: Props) {
  const router = useRouter();
  const [sessions, setSessions] = useState<InterviewSessionSummary[] | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSessions(await listInterviewSessions());
    } catch (caught) {
      setError(
        interviewErrorMessage(
          caught,
          'Could not load your interview sessions.',
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const goBack = () => {
    if (onBack) onBack();
    else if (router.canGoBack()) router.back();
    else router.replace('/you');
  };

  const openReport = (sessionId: string) => {
    router.push({ pathname: '/interview-report', params: { sessionId } });
  };

  const completed = (sessions ?? []).filter(
    (s) => s.state === 'COMPLETED' || s.state === 'EVALUATED',
  );
  const inProgress = (sessions ?? []).filter((s) => s.state === 'IN_PROGRESS');
  const other = (sessions ?? []).filter(
    (s) =>
      s.state !== 'COMPLETED' &&
      s.state !== 'EVALUATED' &&
      s.state !== 'IN_PROGRESS',
  );

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Pressable style={styles.back} onPress={goBack}>
          <ArrowLeft size={18} color="#0A1931" weight="bold" />
        </Pressable>
        <Text style={styles.headerTitle}>Interview reports</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={loading && sessions == null}
            onRefresh={load}
          />
        }
      >
        {loading && sessions == null ? (
          <View style={styles.centerState}>
            <ActivityIndicator size="large" color="#5F4DB2" />
            <Text style={styles.centerTitle}>Loading your sessions</Text>
          </View>
        ) : error ? (
          <View style={styles.centerState}>
            <WarningCircle size={42} color="#993A22" weight="fill" />
            <Text style={styles.centerTitle}>Could not load</Text>
            <Text style={styles.centerBody}>{error}</Text>
            <Pressable style={styles.primary} onPress={load}>
              <Text style={styles.primaryText}>Try again</Text>
            </Pressable>
          </View>
        ) : (sessions ?? []).length === 0 ? (
          <View style={styles.centerState}>
            <MicrophoneStage size={44} color="#5F4DB2" weight="duotone" />
            <Text style={styles.centerTitle}>No interviews yet</Text>
            <Text style={styles.centerBody}>
              When you finish a mock interview, your feedback report will appear
              here.
            </Text>
            <Pressable
              style={styles.primary}
              onPress={() => router.push('/mock-interview')}
            >
              <Text style={styles.primaryText}>Start a mock interview</Text>
            </Pressable>
          </View>
        ) : (
          <>
            {inProgress.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>IN PROGRESS</Text>
                {inProgress.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    onPress={() =>
                      router.push({
                        pathname: '/interview-session',
                        params: { sessionId: session.id },
                      })
                    }
                  />
                ))}
              </>
            )}

            {completed.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>COMPLETED</Text>
                {completed.map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    onPress={() => openReport(session.id)}
                  />
                ))}
              </>
            )}

            {other.length > 0 && (
              <>
                <Text style={styles.sectionLabel}>EARLIER</Text>
                {other.map((session) => (
                  <SessionRow key={session.id} session={session} disabled />
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SessionRow({
  session,
  onPress,
  disabled,
}: {
  session: InterviewSessionSummary;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const dateLabel = formatSessionDate(
    session.completed_at ?? session.created_at,
  );
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && styles.rowPressed,
        disabled && styles.rowDisabled,
      ]}
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <View style={styles.rowTop}>
        <View style={styles.rowIcon}>
          <MicrophoneStage
            size={20}
            color={disabled ? '#9AA4B5' : '#5F4DB2'}
            weight="duotone"
          />
        </View>
        <View style={styles.rowTitleWrap}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            Mock interview #{session.session_number}
          </Text>
        </View>
        {!disabled && <CaretRight size={18} color="#5F6B80" weight="bold" />}
      </View>

      <View style={styles.rowBottom}>
        <Text style={styles.rowDate}>{dateLabel}</Text>
        <StatusPill state={session.state} />
      </View>
    </Pressable>
  );
}

function StatusPill({ state }: { state: InterviewSessionSummary['state'] }) {
  const config: Record<
    InterviewSessionSummary['state'],
    { label: string; bg: string; fg: string; icon?: React.ReactNode }
  > = {
    EVALUATED: {
      label: 'Feedback ready',
      bg: '#DFF2E6',
      fg: '#1F7A4D',
      icon: <CheckCircle size={11} color="#1F7A4D" weight="fill" />,
    },
    COMPLETED: {
      label: 'Feedback pending',
      bg: '#F4EFD8',
      fg: '#7A5C0E',
      icon: <Clock size={11} color="#7A5C0E" weight="fill" />,
    },
    IN_PROGRESS: {
      label: 'In progress',
      bg: '#F1EAF7',
      fg: '#4A3E8F',
      icon: <Clock size={11} color="#4A3E8F" weight="fill" />,
    },
    CREATED: { label: 'Not started', bg: '#EFEAE0', fg: '#5F6B80' },
    ABANDONED: { label: 'Abandoned', bg: '#EFEAE0', fg: '#5F6B80' },
    FAILED: {
      label: 'Failed',
      bg: '#F8E2DC',
      fg: '#993A22',
      icon: <WarningCircle size={11} color="#993A22" weight="fill" />,
    },
  };
  const c = config[state];
  return (
    <View style={[styles.pill, { backgroundColor: c.bg }]}>
      {c.icon}
      <Text style={[styles.pillText, { color: c.fg }]}>{c.label}</Text>
    </View>
  );
}

function formatSessionDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#FFFCF7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E7E0D4',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: '#0A1931',
  },
  content: {
    flexGrow: 1,
    padding: 20,
    paddingTop: 12,
    paddingBottom: 40,
    gap: 10,
  },
  centerState: {
    flex: 1,
    minHeight: 400,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 10,
  },
  centerTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 22,
    color: '#0A1931',
    textAlign: 'center',
  },
  centerBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#3A4761',
    textAlign: 'center',
  },
  sectionLabel: {
    marginTop: 8,
    marginBottom: 2,
    fontFamily: 'SpaceMono-Bold',
    fontSize: 11,
    letterSpacing: 1.1,
    color: '#5F6B80',
  },
  row: {
    gap: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: Radii.card,
    backgroundColor: '#FFFFFF',
  },
  rowPressed: { transform: [{ scale: 0.98 }], opacity: 0.9 },
  rowDisabled: { opacity: 0.6 },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F2EFFB',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowTitleWrap: {
    flex: 1,
  },
  rowTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 22,
    color: '#0A1931',
  },
  rowBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 52,
    gap: 8,
  },
  rowDate: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: Radii.pill,
  },
  pillText: { fontFamily: 'GeneralSans-Semibold', fontSize: 11 },
  primary: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: Radii.pill,
    backgroundColor: '#5F4DB2',
    marginTop: 4,
  },
  primaryText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    color: '#FFFFFF',
  },
});
