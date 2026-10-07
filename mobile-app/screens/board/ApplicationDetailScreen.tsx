/**
 * BharatPath - ApplicationDetailScreen
 *
 * One of the candidate's applications, wired to
 * `GET /candidate/applications/{id}`. Reading is NOT paywalled (R13).
 *
 * Header: job title + employer name only. No location or salary - the job
 * fetch is paywalled and 404s for closed jobs, so it is not safely fetchable
 * from the detail screen.
 *
 * Interview card: shown when `interview` is present. Join opens the employer's
 * https meeting link externally. There is NO reschedule - the candidate
 * cannot reschedule (screen-flows §2.10).
 *
 * Timeline: built from `history[]`. `by` is a party (CANDIDATE/EMPLOYER/
 * SYSTEM), never "which recruiter" - employer notes and recruiter ids are
 * employer-only.
 *
 * State-driven actions:
 *   - active + NONE      → Withdraw (confirm dialog)
 *   - PENDING            → Confirm hire / Dispute panel
 *   - DISPUTED           → "Not right" note + Confirm still available
 *   - HIRED              → "Congratulations" no actions
 *   - REJECTED/WITHDRAWN/EXPIRED → final message, no actions
 *
 * 409 `application_invalid_transition` / `hire_confirmation_not_pending` →
 * "This application has changed" + reload.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { AppAlert } from "@/components/feedback/AppAlert";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  Alert,
  Linking,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  VideoCamera,
  CheckCircle,
  CircleDashed,
  ArrowUUpLeft,
  Sparkle,
  Warning,
} from 'phosphor-react-native';
import { Colors, Layout, Spacing } from '@/theme/tokens';
import {
  getMyApplication,
  withdrawApplication,
  confirmHire,
  disputeHire,
  isApplicationChangedError,
  applicationActionErrorMessage,
} from '@/services/api/applications';
import { ApiError } from '@/services/api/client';
import {
  ApplicationDetailResponse,
  ApplicationStage,
  CandidateHistoryItem,
  isActiveStage,
  stageLabel,
} from '@/types/application';
import { getInitials, pickFromString, formatPostedAgo } from '@/utils/helpers';

const MONOGRAM_BG = ['#F1EAF7', '#F7EFD6', '#E6F1EA', '#F4EFE4'] as const;
const MONOGRAM_FG = ['#4A3E8F', '#7A5C0E', '#1F6B45', '#5F6B80'] as const;

// Strings extracted to consts to satisfy `react/no-unescaped-entities`.
const WHERE_THINGS_STAND = 'Where things stand';
const YOUR_INTERVIEW = 'YOUR INTERVIEW';
const JOIN_CALL = 'Join call';
const WITHDRAW_APPLICATION = 'Withdraw application';
const WITHDRAW_TITLE = 'Withdraw application?';
const WITHDRAW_BODY =
  'You can withdraw this application. The employer will see it as withdrawn.';
const WITHDRAW_CANCEL = 'Cancel';
const WITHDRAW_CONFIRM = 'Withdraw';
const CONFIRM_HIRE_TITLE = 'Confirm the hire';
const CONFIRM_HIRE_BODY =
  'This employer proposed you for the role. Confirm to accept the offer.';
const CONFIRM_ACTION = 'Confirm hire';
const DISPUTE_ACTION = 'Not right';
const DISPUTE_BODY =
  'If something is not right, dispute the hire. The employer will be notified and the hire stays unconfirmed.';
const DISPUTE_TITLE = 'Dispute this hire?';
const DISPUTE_CANCEL = 'Cancel';
const DISPUTE_CONFIRM = 'Dispute';
const DISPUTED_NOTE =
  'You disputed this hire. You can still confirm it if the issue is resolved.';
const HIRED_TITLE = 'Congratulations';
const HIRED_BODY = 'You accepted this offer. The employer will be in touch.';
const REJECTED_BODY = 'The employer did not select you for this role.';
const WITHDRAWN_BODY = 'You withdrew this application.';
const EXPIRED_BODY = 'Closed with no response from the employer.';
const CHANGED_BODY =
  'The status changed while this screen was open. Refreshing…';
const LOAD_FAILED = 'Could not load this application.';
const RETRY = 'Retry';
const APPLIED_PREFIX = 'applied ';

export interface ApplicationDetailScreenProps {
  applicationId: string;
  onBack?: () => void;
}

export function ApplicationDetailScreen({
  applicationId,
  onBack,
}: ApplicationDetailScreenProps) {
  const [app, setApp] = useState<ApplicationDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionInFlight, setActionInFlight] = useState(false);
  const [changedNotice, setChangedNotice] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await getMyApplication(applicationId);
      setApp(detail);
      setChangedNotice(false);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError('This application could not be found.');
      } else if (err instanceof ApiError) {
        setError(err.problem.title || LOAD_FAILED);
      } else {
        setError(LOAD_FAILED);
      }
      setApp(null);
    } finally {
      setLoading(false);
    }
  }, [applicationId]);

  // Initial load.
  useEffect(() => {
    void load();
  }, [load]);

  // Re-fetch on focus - the state may have changed while away.
  useFocusEffect(
    useCallback(() => {
      if (!loading) void load();
    }, [load, loading]),
  );

  const handleActionError = useCallback(
    (err: unknown) => {
      if (isApplicationChangedError(err)) {
        setChangedNotice(true);
        void load();
        return;
      }
      const msg = applicationActionErrorMessage(err);
      AppAlert.alert('Could not complete', msg || 'Please try again.');
    },
    [load],
  );

  const onWithdraw = useCallback(() => {
    AppAlert.alert(WITHDRAW_TITLE, WITHDRAW_BODY, [
      { text: WITHDRAW_CANCEL, style: 'cancel' },
      {
        text: WITHDRAW_CONFIRM,
        style: 'destructive',
        onPress: async () => {
          setActionInFlight(true);
          try {
            await withdrawApplication(applicationId);
            await load();
          } catch (err) {
            handleActionError(err);
          } finally {
            setActionInFlight(false);
          }
        },
      },
    ]);
  }, [applicationId, load, handleActionError]);

  const onConfirm = useCallback(async () => {
    setActionInFlight(true);
    try {
      await confirmHire(applicationId);
      await load();
    } catch (err) {
      handleActionError(err);
    } finally {
      setActionInFlight(false);
    }
  }, [applicationId, load, handleActionError]);

  const onDispute = useCallback(() => {
    AppAlert.alert(DISPUTE_TITLE, DISPUTE_BODY, [
      { text: DISPUTE_CANCEL, style: 'cancel' },
      {
        text: DISPUTE_CONFIRM,
        style: 'destructive',
        onPress: async () => {
          setActionInFlight(true);
          try {
            await disputeHire(applicationId);
            await load();
          } catch (err) {
            handleActionError(err);
          } finally {
            setActionInFlight(false);
          }
        },
      },
    ]);
  }, [applicationId, load, handleActionError]);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Bar */}
          <View style={styles.topBar}>
            <Pressable
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <ArrowLeft size={16} color={Colors.navy} weight="bold" />
            </Pressable>
            <Text style={styles.topBarTitle} numberOfLines={1}>
              {app?.job_title || 'Application'}
            </Text>
          </View>

          {changedNotice && (
            <View style={styles.changedBanner}>
              <Warning size={16} color="#7A5C0E" weight="bold" />
              <Text style={styles.changedBannerText}>{CHANGED_BODY}</Text>
            </View>
          )}

          {loading && !app ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#5F4DB2" />
            </View>
          ) : error && !app ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable style={styles.retryButton} onPress={load}>
                <Text style={styles.retryButtonText}>{RETRY}</Text>
              </Pressable>
            </View>
          ) : app ? (
            <DetailBody
              app={app}
              actionInFlight={actionInFlight}
              onWithdraw={onWithdraw}
              onConfirm={onConfirm}
              onDispute={onDispute}
            />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Detail body
// ---------------------------------------------------------------------------

function DetailBody({
  app,
  actionInFlight,
  onWithdraw,
  onConfirm,
  onDispute,
}: {
  app: ApplicationDetailResponse;
  actionInFlight: boolean;
  onWithdraw: () => void;
  onConfirm: () => void;
  onDispute: () => void;
}) {
  const name = app.employer_name || 'Unknown employer';
  const initials = getInitials(name);
  const bg = pickFromString(name, [...MONOGRAM_BG]);
  const fg = pickFromString(name, [...MONOGRAM_FG]);
  const stageTag = stageLabel(app.stage);

  return (
    <>
      {/* Company & Role Header (no location/salary) */}
      <View style={styles.companyHeader}>
        <View style={[styles.companyBadge, { backgroundColor: bg }]}>
          <Text style={[styles.companyBadgeText, { color: fg }]}>
            {initials}
          </Text>
        </View>
        <View style={styles.companyInfo}>
          <Text style={styles.companyTitle} numberOfLines={1}>
            {app.job_title || 'Untitled role'}
          </Text>
          <Text style={styles.companySub} numberOfLines={1}>
            {name} · {APPLIED_PREFIX}
            {formatPostedAgo(app.created_at)
              .replace('Posted ', '')
              .toLowerCase()}
          </Text>
        </View>
        <View style={styles.stageBadgePill}>
          <Text style={styles.stageBadgeText}>{stageTag}</Text>
        </View>
      </View>

      {/* Interview card (when present) */}
      {app.interview && app.interview.meeting_url && (
        <InterviewCard app={app} />
      )}

      {/* Hire confirmation panel (PENDING or DISPUTED) */}
      {app.hire_confirmation === 'PENDING' && (
        <HirePanel
          variant="pending"
          actionInFlight={actionInFlight}
          onConfirm={onConfirm}
          onDispute={onDispute}
        />
      )}
      {app.hire_confirmation === 'DISPUTED' && (
        <HirePanel
          variant="disputed"
          actionInFlight={actionInFlight}
          onConfirm={onConfirm}
        />
      )}

      {/* HIRED congratulations banner */}
      {app.stage === 'HIRED' && (
        <FinalBanner
          icon={<CheckCircle size={20} color="#1F6B45" weight="fill" />}
          title={HIRED_TITLE}
          body={HIRED_BODY}
          tone="success"
        />
      )}

      {/* Terminal final messages (no actions) */}
      {(app.stage === 'REJECTED' ||
        app.stage === 'WITHDRAWN' ||
        app.stage === 'EXPIRED') && (
        <FinalBanner
          icon={<CircleDashed size={20} color="#5F6B80" weight="bold" />}
          title={stageLabel(app.stage)}
          body={
            app.stage === 'REJECTED'
              ? REJECTED_BODY
              : app.stage === 'WITHDRAWN'
                ? WITHDRAWN_BODY
                : EXPIRED_BODY
          }
          tone="neutral"
        />
      )}

      {/* Timeline */}
      <TimelineCard history={app.history} currentStage={app.stage} />

      {/* Withdraw action (active + NONE only) */}
      {isActiveStage(app.stage) && app.hire_confirmation === 'NONE' && (
        <Pressable
          style={({ pressed }) => [
            styles.withdrawButton,
            pressed && styles.buttonPressed,
            actionInFlight && styles.actionDisabled,
          ]}
          onPress={onWithdraw}
          disabled={actionInFlight}
          accessibilityRole="button"
        >
          <ArrowUUpLeft size={16} color="#3A4761" weight="bold" />
          <Text style={styles.withdrawButtonText}>{WITHDRAW_APPLICATION}</Text>
        </Pressable>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Interview card
// ---------------------------------------------------------------------------

function InterviewCard({ app }: { app: ApplicationDetailResponse }) {
  const interview = app.interview!;
  const when = formatInterviewLong(interview.interview_at);

  return (
    <View style={styles.interviewCard}>
      <View style={styles.eyebrowRow}>
        <VideoCamera size={18} color="#5E4DB2" weight="fill" />
        <Text style={styles.eyebrowText}>{YOUR_INTERVIEW}</Text>
      </View>
      <Text style={styles.interviewTitleText}>{when}</Text>
      <Text style={styles.interviewDescText}>
        Join the video call at the scheduled time.
      </Text>
      <Pressable
        style={({ pressed }) => [
          styles.joinButton,
          pressed && styles.buttonPressed,
        ]}
        onPress={() => void Linking.openURL(interview.meeting_url)}
        accessibilityRole="button"
      >
        <Text style={styles.joinButtonText}>{JOIN_CALL}</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Hire confirmation panel
// ---------------------------------------------------------------------------

function HirePanel({
  variant,
  actionInFlight,
  onConfirm,
  onDispute,
}: {
  variant: 'pending' | 'disputed';
  actionInFlight: boolean;
  onConfirm: () => void;
  onDispute?: () => void;
}) {
  return (
    <View style={styles.hirePanel}>
      <View style={styles.hirePanelHeader}>
        <View style={styles.hirePanelIcon}>
          <Sparkle size={16} color="#5F4DB2" weight="bold" />
        </View>
        <Text style={styles.hirePanelTitle}>{CONFIRM_HIRE_TITLE}</Text>
      </View>
      <Text style={styles.hirePanelBody}>
        {variant === 'pending' ? CONFIRM_HIRE_BODY : DISPUTED_NOTE}
      </Text>
      <View style={styles.hireButtonsRow}>
        <Pressable
          style={({ pressed }) => [
            styles.confirmButton,
            pressed && styles.buttonPressed,
            actionInFlight && styles.actionDisabled,
          ]}
          onPress={onConfirm}
          disabled={actionInFlight}
          accessibilityRole="button"
        >
          <Text style={styles.confirmButtonText}>{CONFIRM_ACTION}</Text>
        </Pressable>
        {variant === 'pending' && onDispute && (
          <Pressable
            style={({ pressed }) => [
              styles.disputeButton,
              pressed && styles.buttonPressed,
              actionInFlight && styles.actionDisabled,
            ]}
            onPress={onDispute}
            disabled={actionInFlight}
            accessibilityRole="button"
          >
            <Text style={styles.disputeButtonText}>{DISPUTE_ACTION}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Final banner (HIRED / REJECTED / WITHDRAWN / EXPIRED)
// ---------------------------------------------------------------------------

function FinalBanner({
  icon,
  title,
  body,
  tone,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  tone: 'success' | 'neutral';
}) {
  return (
    <View
      style={[
        styles.finalBanner,
        tone === 'success'
          ? styles.finalBannerSuccess
          : styles.finalBannerNeutral,
      ]}
    >
      <View style={styles.finalBannerIcon}>{icon}</View>
      <View style={styles.finalBannerText}>
        <Text style={styles.finalBannerTitle}>{title}</Text>
        <Text style={styles.finalBannerBody}>{body}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

function TimelineCard({
  history,
  currentStage,
}: {
  history: CandidateHistoryItem[];
  currentStage: ApplicationStage;
}) {
  // Show the pipeline stages in order, marking each as completed / current /
  // pending based on the history and the current stage.
  const items = buildTimeline(history, currentStage);

  return (
    <View style={styles.timelineCard}>
      <Text style={styles.timelineTitle}>{WHERE_THINGS_STAND}</Text>
      <View style={styles.timelineList}>
        {items.map((item, idx) => {
          const isLast = idx === items.length - 1;
          return (
            <View
              key={`${item.label}-${idx}`}
              style={isLast ? styles.timelineStepLast : styles.timelineStep}
            >
              <View style={styles.stepNodeCol}>
                {item.state === 'done' ? (
                  <CheckCircle size={20} color="#1F6B45" weight="fill" />
                ) : item.state === 'current' ? (
                  <CircleDashed size={20} color="#5E4DB2" weight="bold" />
                ) : (
                  <View style={styles.circleNode} />
                )}
                {!isLast && (
                  <View
                    style={[
                      styles.connectorLine,
                      item.state === 'done'
                        ? styles.lineGreen
                        : styles.lineBeige,
                    ]}
                  />
                )}
              </View>
              <View
                style={isLast ? styles.stepContentLast : styles.stepContent}
              >
                <Text
                  style={
                    item.state === 'pending'
                      ? styles.stepTitleMuted
                      : styles.stepTitle
                  }
                >
                  {item.label}
                </Text>
                {item.sub && (
                  <Text
                    style={
                      item.state === 'current'
                        ? styles.stepSubActive
                        : styles.stepSub
                    }
                  >
                    {item.sub}
                  </Text>
                )}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

interface TimelineItem {
  label: string;
  sub: string | null;
  state: 'done' | 'current' | 'pending';
}

/** Build a 5-step pipeline timeline from the history + current stage. */
function buildTimeline(
  history: CandidateHistoryItem[],
  currentStage: ApplicationStage,
): TimelineItem[] {
  const PIPELINE_LABELS = [
    'Application sent',
    'Profile opened by employer',
    'Shortlisted',
    'Interview',
    'Decision',
  ];
  const STAGE_TO_INDEX: Record<ApplicationStage, number> = {
    SUBMITTED: 0,
    VIEWED: 1,
    SHORTLISTED: 2,
    INTERVIEW: 3,
    DECISION: 4,
    HIRED: 4,
    REJECTED: 4,
    WITHDRAWN: 4,
    EXPIRED: 4,
  };

  const currentIndex = STAGE_TO_INDEX[currentStage] ?? 0;
  const isTerminal = !isActiveStage(currentStage);

  // Find the timestamp for each stage from the history (first occurrence).
  const stageTimes: Record<number, string> = {};
  for (const h of history) {
    const idx = STAGE_TO_INDEX[h.to_stage];
    if (idx != null && stageTimes[idx] == null) {
      stageTimes[idx] = h.occurred_at;
    }
  }

  return PIPELINE_LABELS.map((label, idx) => {
    let state: TimelineItem['state'] = 'pending';
    let sub: string | null = null;

    if (idx < currentIndex) {
      state = 'done';
      sub = stageTimes[idx] ? formatTimelineDate(stageTimes[idx]) : null;
    } else if (idx === currentIndex) {
      if (isTerminal) {
        // Terminal stage: mark the decision step as done with the final label.
        state = 'done';
        sub = stageTimes[idx] ? formatTimelineDate(stageTimes[idx]) : null;
      } else {
        state = 'current';
        sub = stageStatusShort(currentStage);
      }
    }
    return { label, sub, state };
  });
}

function stageStatusShort(stage: ApplicationStage): string {
  switch (stage) {
    case 'SUBMITTED':
      return 'Waiting on employer';
    case 'VIEWED':
      return 'Profile opened';
    case 'SHORTLISTED':
      return 'Shortlisted';
    case 'INTERVIEW':
      return 'Scheduled';
    case 'DECISION':
      return 'Pending';
    default:
      return stageLabel(stage);
  }
}

function formatTimelineDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

function formatInterviewLong(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Scheduled';
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfThat = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime();
  const dayDiff = Math.round((startOfThat - startOfToday) / 86_400_000);
  const date = d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
  const time = d
    .toLocaleTimeString('en-IN', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: 'Asia/Kolkata',
    })
    .toLowerCase();
  if (dayDiff === 0) return `Today, ${time}`;
  if (dayDiff === 1) return `Tomorrow, ${time}`;
  return `${date}, ${time}`;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFCF7',
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: 16,
    flexGrow: 1,
    maxWidth: Layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBarTitle: {
    flex: 1,
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: Colors.navy,
  },
  changedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F7EFD6',
    borderRadius: 12,
    padding: 12,
  },
  changedBannerText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    lineHeight: 16,
    color: '#7A5C0E',
  },
  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    color: '#993A22',
    textAlign: 'center',
  },
  retryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#5F4DB2',
  },
  retryButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  companyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 16,
  },
  companyBadge: {
    width: 48,
    height: 48,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
  },
  companyBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 15,
    lineHeight: 20,
  },
  companyInfo: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  companyTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.4,
    color: Colors.navy,
  },
  companySub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 16,
    color: '#5F6B80',
  },
  stageBadgePill: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
  },
  stageBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 12,
    color: Colors.navy,
  },
  interviewCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  eyebrowText: {
    fontFamily: Platform.select({
      ios: 'SpaceMono-Bold',
      android: 'SpaceMono-Bold',
      default: 'monospace',
    }),
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 1.2,
    color: '#5E4DB2',
  },
  interviewTitleText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.4,
    color: Colors.navy,
  },
  interviewDescText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  joinButton: {
    backgroundColor: '#5F4DB2',
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  hirePanel: {
    backgroundColor: '#F1EAF7',
    borderWidth: 1,
    borderColor: '#5F4DB2',
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  hirePanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hirePanelIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hirePanelTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    color: '#4A3E8F',
  },
  hirePanelBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#3A4761',
  },
  hireButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  confirmButton: {
    flex: 1,
    backgroundColor: '#5F4DB2',
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  disputeButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disputeButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.navy,
  },
  finalBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: 20,
    padding: 16,
  },
  finalBannerSuccess: {
    backgroundColor: '#E6F1EA',
  },
  finalBannerNeutral: {
    backgroundColor: '#F4EFE4',
  },
  finalBannerIcon: {
    marginTop: 2,
  },
  finalBannerText: {
    flex: 1,
    gap: 4,
  },
  finalBannerTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
  },
  finalBannerBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#3A4761',
  },
  timelineCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 16,
    gap: 16,
  },
  timelineTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
  },
  timelineList: {
    gap: 0,
  },
  timelineStep: {
    flexDirection: 'row',
    gap: 12,
  },
  stepNodeCol: {
    alignItems: 'center',
    flexBasis: 20,
  },
  connectorLine: {
    width: 2,
    flex: 1,
    minHeight: 22,
  },
  lineGreen: {
    backgroundColor: '#1F6B45',
  },
  lineBeige: {
    backgroundColor: '#E7E0D4',
  },
  stepContent: {
    flex: 1,
    gap: 2,
    paddingBottom: 16,
  },
  stepTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.navy,
  },
  stepSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  stepSubActive: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5E4DB2',
  },
  timelineStepLast: {
    flexDirection: 'row',
    gap: 12,
  },
  circleNode: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#DDD6C7',
  },
  stepContentLast: {
    flex: 1,
    gap: 2,
  },
  stepTitleMuted: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 20,
    color: '#566073',
  },
  withdrawButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingVertical: 16,
  },
  withdrawButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: '#3A4761',
  },
  actionDisabled: {
    opacity: 0.5,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
});
