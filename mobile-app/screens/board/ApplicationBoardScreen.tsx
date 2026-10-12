/**
 * BharatPath - ApplicationBoardScreen ("Board" tab)
 *
 * The candidate's own applications, wired to `GET /candidate/applications`.
 * Reading the board is NOT paywalled (R13 - a lapsed subscriber loses access,
 * not their data).
 *
 * The API has no stage filter and `total` is always `null`, so this screen
 * loads ALL applications via `useApplications()` and partitions them into
 * Active / Closed client-side using the stage sets. Filter-pill counts come
 * from the loaded items, not a server total.
 *
 * Card priority (active tab):
 *   1. PENDING hire → highlighted "Confirm hire?" banner card → detail
 *   2. INTERVIEW stage with interview present → interview card + Join
 *   3. Normal stage card with "Stage N of 5" bar
 * Closed tab: final chip + reason line, no bar, no special cards.
 *
 * No location or salary is shown - the job fetch is paywalled and 404s for
 * closed jobs, so it is not safely fetchable from the board.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  RefreshControl,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  VideoCamera,
  Eye,
  Archive,
  CheckCircle,
  Sparkle,
  Tray,
} from 'phosphor-react-native';
import { Colors, Spacing } from '@/theme/tokens';
import { BottomTabBar, TabName } from '@/components/navigation/BottomTabBar';
import { useApplications } from '@/hooks/useApplications';
import {
  ApplicationResponse,
  isActiveStage,
  isClosedStage,
  pipelineStep,
  PIPELINE_LENGTH,
  stageLabel,
  stageStatusText,
  stageChipStyle,
} from '@/types/application';
import { getInitials, pickFromString, formatPostedAgo } from '@/utils/helpers';

// Monogram background palette (deterministic per employer name).
const MONOGRAM_BG = ['#F1EAF7', '#F7EFD6', '#E6F1EA', '#F4EFE4'] as const;
const MONOGRAM_FG = ['#4A3E8F', '#7A5C0E', '#1F6B45', '#5F6B80'] as const;

export interface ApplicationBoardScreenProps {
  activeTab?: TabName;
  onTabPress?: (tab: TabName, href: string) => void;
  onApplicationPress?: (appId: string) => void;
}

// Strings extracted to consts to satisfy `react/no-unescaped-entities`.
const TITLE = 'Your applications';
const ACTIVE_LABEL = 'Active';
const CLOSED_LABEL = 'Closed';
const LOADING = 'Loading your applications…';
const LOAD_FAILED = 'Could not load your applications. Pull to retry.';
const EMPTY_ACTIVE_TITLE = 'No active applications';
const EMPTY_ACTIVE_BODY =
  'Applications you send will appear here with their stage.';
const EMPTY_CLOSED_TITLE = 'No closed applications';
const EMPTY_CLOSED_BODY =
  'Applications that are hired, not selected, withdrawn or closed will appear here.';
const FIND_JOBS = 'Find jobs';
const CONFIRM_HIRE_PROMPT = 'Confirm hire?';
const CONFIRM_HIRE_BODY =
  'This employer proposed you for the role. Open to review and confirm.';
const REVIEW_ACTION = 'Review';
const JOIN_LABEL = 'Join';
const STAGE_OF = 'STAGE';
const OF = 'OF';
const APPLIED_PREFIX = 'applied ';

export function ApplicationBoardScreen({
  activeTab = 'board',
  onTabPress,
  onApplicationPress,
}: ApplicationBoardScreenProps) {
  const [filter, setFilter] = useState<'active' | 'closed'>('active');
  const {
    applications,
    loading,
    loadingMore,
    hasReachedEnd,
    error,
    loadMore,
    reload,
  } = useApplications();

  // Partition client-side - the API has no stage filter.
  const { active, closed } = useMemo(() => {
    const activeList: ApplicationResponse[] = [];
    const closedList: ApplicationResponse[] = [];
    for (const app of applications) {
      if (isActiveStage(app.stage)) activeList.push(app);
      else if (isClosedStage(app.stage)) closedList.push(app);
    }
    return { active: activeList, closed: closedList };
  }, [applications]);

  const list = filter === 'active' ? active : closed;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={loading && applications.length > 0}
              onRefresh={reload}
              tintColor="#5F4DB2"
            />
          }
          onScroll={({ nativeEvent }) => {
            const { layoutMeasurement, contentOffset, contentSize } =
              nativeEvent;
            const nearEnd =
              layoutMeasurement.height + contentOffset.y >=
              contentSize.height - 200;
            if (nearEnd && !hasReachedEnd && !loadingMore && !loading) {
              loadMore();
            }
          }}
          scrollEventThrottle={16}
        >
          {/* Header Title and Filter Pills */}
          <View style={styles.headerSection}>
            <Text style={styles.mainTitle}>{TITLE}</Text>
            <View style={styles.filterRow}>
              <Pressable
                style={[
                  styles.filterPill,
                  filter === 'active'
                    ? styles.filterPillActive
                    : styles.filterPillInactive,
                ]}
                onPress={() => setFilter('active')}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.filterPillText,
                    filter === 'active'
                      ? styles.filterPillTextActive
                      : styles.filterPillTextInactive,
                  ]}
                >
                  {ACTIVE_LABEL} · {active.length}
                </Text>
              </Pressable>

              <Pressable
                style={[
                  styles.filterPill,
                  filter === 'closed'
                    ? styles.filterPillActive
                    : styles.filterPillInactive,
                ]}
                onPress={() => setFilter('closed')}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.filterPillText,
                    filter === 'closed'
                      ? styles.filterPillTextActive
                      : styles.filterPillTextInactive,
                  ]}
                >
                  {CLOSED_LABEL} · {closed.length}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Body */}
          {loading && applications.length === 0 ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#5F4DB2" />
              <Text style={styles.loadingText}>{LOADING}</Text>
            </View>
          ) : error && applications.length === 0 ? (
            <View style={styles.loadingContainer}>
              <Text style={styles.errorText}>{LOAD_FAILED}</Text>
              <Pressable style={styles.retryButton} onPress={reload}>
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : list.length === 0 ? (
            <EmptyState filter={filter} onTabPress={onTabPress} />
          ) : (
            <View style={styles.listContainer}>
              {list.map((app) => (
                <ApplicationCard
                  key={app.id}
                  application={app}
                  closed={filter === 'closed'}
                  onPress={() => onApplicationPress?.(app.id)}
                />
              ))}
              {loadingMore && (
                <View style={styles.loadingMoreRow}>
                  <ActivityIndicator size="small" color="#5F4DB2" />
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      {onTabPress && (
        <BottomTabBar activeTab={activeTab} onTabPress={onTabPress} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({
  filter,
  onTabPress,
}: {
  filter: 'active' | 'closed';
  onTabPress?: (tab: TabName, href: string) => void;
}) {
  const title = filter === 'active' ? EMPTY_ACTIVE_TITLE : EMPTY_CLOSED_TITLE;
  const body = filter === 'active' ? EMPTY_ACTIVE_BODY : EMPTY_CLOSED_BODY;
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconWell}>
        <Tray size={28} color="#5F6B80" weight="duotone" />
      </View>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyBody}>{body}</Text>
      {filter === 'active' && (
        <Pressable
          style={({ pressed }) => [
            styles.findJobsButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => onTabPress?.('jobs', '/jobs')}
          accessibilityRole="button"
        >
          <Text style={styles.findJobsButtonText}>{FIND_JOBS}</Text>
        </Pressable>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Application card - picks the right variant by stage + hire + interview
// ---------------------------------------------------------------------------

interface ApplicationCardProps {
  application: ApplicationResponse;
  closed: boolean;
  onPress: () => void;
}

function ApplicationCard({
  application,
  closed,
  onPress,
}: ApplicationCardProps) {
  // Closed cards: final chip + reason line, no bar, no special cards.
  if (closed) {
    return <ClosedCard application={application} onPress={onPress} />;
  }

  // Active - priority 1: PENDING hire → highlighted "Confirm hire?" banner.
  if (application.hire_confirmation === 'PENDING') {
    return <PendingHireCard application={application} onPress={onPress} />;
  }

  // Active - priority 2: INTERVIEW stage with interview present → interview card.
  if (
    application.stage === 'INTERVIEW' &&
    application.interview &&
    application.interview.meeting_url
  ) {
    return <InterviewCard application={application} onPress={onPress} />;
  }

  // Active - priority 3: normal stage card with "Stage N of 5" bar.
  return <StageCard application={application} onPress={onPress} />;
}

// ---------------------------------------------------------------------------
// Monogram + employer header (shared)
// ---------------------------------------------------------------------------

function EmployerHeader({
  application,
  tag,
  tagStyle,
}: {
  application: ApplicationResponse;
  tag: string;
  tagStyle: 'accent' | 'success' | 'neutral';
}) {
  const name = application.employer_name || 'Unknown employer';
  const initials = getInitials(name);
  const bg = pickFromString(name, [...MONOGRAM_BG]);
  const fg = pickFromString(name, [...MONOGRAM_FG]);
  const tagColors =
    tagStyle === 'success'
      ? { bg: '#E6F1EA', fg: '#1F6B45' }
      : tagStyle === 'accent'
        ? { bg: '#F1EAF7', fg: '#4A3E8F' }
        : { bg: '#F0EBDF', fg: '#5F6B80' };

  return (
    <View style={styles.cardHeader}>
      <View style={[styles.badgeMonogram, { backgroundColor: bg }]}>
        <Text style={[styles.badgeMonogramText, { color: fg }]}>
          {initials}
        </Text>
      </View>
      <View style={styles.roleInfo}>
        <Text style={styles.roleTitle} numberOfLines={1}>
          {application.job_title || 'Untitled role'}
        </Text>
        <Text style={styles.roleSub} numberOfLines={1}>
          {name} · {APPLIED_PREFIX}
          {formatPostedAgo(application.created_at)
            .replace('Posted ', '')
            .toLowerCase()}
        </Text>
      </View>
      <View style={[styles.tag, { backgroundColor: tagColors.bg }]}>
        <Text style={[styles.tagText, { color: tagColors.fg }]}>{tag}</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Stage card (normal active)
// ---------------------------------------------------------------------------

function StageCard({
  application,
  onPress,
}: {
  application: ApplicationResponse;
  onPress: () => void;
}) {
  const step = pipelineStep(application.stage);
  const chip = stageChipStyle(application.stage);
  const tag =
    application.stage === 'SUBMITTED'
      ? 'SENT'
      : stageLabel(application.stage).toUpperCase();

  return (
    <Pressable
      style={({ pressed }) => [styles.appCard, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <EmployerHeader application={application} tag={tag} tagStyle={chip} />

      <View style={styles.progressSection}>
        <View style={styles.progressBar}>
          {Array.from({ length: PIPELINE_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressSegment,
                i < step ? styles.segmentFilled : styles.segmentEmpty,
              ]}
            />
          ))}
        </View>
        <View style={styles.stageLabelRow}>
          <Text style={styles.stageNumberText}>
            {STAGE_OF} {step} {OF} {PIPELINE_LENGTH}
          </Text>
          <Text style={styles.stageStatusText}>
            {stageStatusText(application.stage)}
          </Text>
        </View>
      </View>

      {application.stage === 'SUBMITTED' && (
        <View style={styles.cardFooterNotice}>
          <Eye size={14} color="#5F6B80" weight="bold" />
          <Text style={styles.cardFooterNoticeText}>
            Employers usually open profiles within a few days
          </Text>
        </View>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Interview card (INTERVIEW stage + interview present)
// ---------------------------------------------------------------------------

function InterviewCard({
  application,
  onPress,
}: {
  application: ApplicationResponse;
  onPress: () => void;
}) {
  const interview = application.interview!;
  const when = formatInterviewShort(interview.interview_at);

  return (
    <Pressable
      style={({ pressed }) => [styles.appCard, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <EmployerHeader
        application={application}
        tag="INTERVIEW"
        tagStyle="accent"
      />

      <View style={styles.progressSection}>
        <View style={styles.progressBar}>
          {Array.from({ length: PIPELINE_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressSegment,
                i < 4 ? styles.segmentFilled : styles.segmentEmpty,
              ]}
            />
          ))}
        </View>
        <View style={styles.stageLabelRow}>
          <Text style={styles.stageNumberText}>
            {STAGE_OF} 4 {OF} {PIPELINE_LENGTH}
          </Text>
          <Text style={styles.stageStatusText}>Interview scheduled</Text>
        </View>
      </View>

      <View style={styles.interviewActionBanner}>
        <VideoCamera size={17} color="#4A3E8F" weight="duotone" />
        <Text style={styles.interviewActionText}>{when} · video call</Text>
        <Pressable
          style={({ pressed }) => [
            styles.joinButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={(e) => {
            e.stopPropagation();
            void Linking.openURL(interview.meeting_url);
          }}
          accessibilityRole="button"
        >
          <Text style={styles.joinButtonText}>{JOIN_LABEL}</Text>
        </Pressable>
      </View>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Pending hire card (highlighted "Confirm hire?" banner)
// ---------------------------------------------------------------------------

function PendingHireCard({
  application,
  onPress,
}: {
  application: ApplicationResponse;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.appCard,
        styles.pendingHireCard,
        pressed && styles.cardPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={styles.pendingBanner}>
        <View style={styles.pendingBannerIcon}>
          <Sparkle size={16} color="#5F4DB2" weight="bold" />
        </View>
        <View style={styles.pendingBannerText}>
          <Text style={styles.pendingBannerTitle}>{CONFIRM_HIRE_PROMPT}</Text>
          <Text style={styles.pendingBannerBody}>{CONFIRM_HIRE_BODY}</Text>
        </View>
      </View>

      <EmployerHeader
        application={application}
        tag="DECISION"
        tagStyle="accent"
      />

      <View style={styles.progressSection}>
        <View style={styles.progressBar}>
          {Array.from({ length: PIPELINE_LENGTH }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.progressSegment,
                i < 5 ? styles.segmentFilled : styles.segmentEmpty,
              ]}
            />
          ))}
        </View>
        <View style={styles.stageLabelRow}>
          <Text style={styles.stageNumberText}>
            {STAGE_OF} 5 {OF} {PIPELINE_LENGTH}
          </Text>
          <Text style={styles.stageStatusText}>Decision pending</Text>
        </View>
      </View>

      <Pressable
        style={({ pressed }) => [
          styles.reviewButton,
          pressed && styles.buttonPressed,
        ]}
        onPress={onPress}
        accessibilityRole="button"
      >
        <Text style={styles.reviewButtonText}>{REVIEW_ACTION}</Text>
      </Pressable>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Closed card (final chip + reason line, no bar)
// ---------------------------------------------------------------------------

function ClosedCard({
  application,
  onPress,
}: {
  application: ApplicationResponse;
  onPress: () => void;
}) {
  const tag = stageLabel(application.stage).toUpperCase();
  const chip = stageChipStyle(application.stage);
  const reason = closedReason(application);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.closedCard,
        pressed && styles.cardPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={styles.cardHeader}>
        <View style={styles.badgeGray}>
          {application.stage === 'HIRED' ? (
            <CheckCircle size={20} color="#1F6B45" weight="duotone" />
          ) : (
            <Archive size={20} color="#5F6B80" weight="duotone" />
          )}
        </View>
        <View style={styles.roleInfo}>
          <Text style={styles.roleTitle} numberOfLines={1}>
            {application.job_title || 'Untitled role'}
          </Text>
          <Text style={styles.roleSub} numberOfLines={1}>
            {application.employer_name || 'Unknown employer'} · {APPLIED_PREFIX}
            {formatPostedAgo(application.created_at)
              .replace('Posted ', '')
              .toLowerCase()}
          </Text>
        </View>
        <View
          style={[
            styles.tag,
            chip === 'success'
              ? { backgroundColor: '#E6F1EA' }
              : { backgroundColor: '#F0EBDF' },
          ]}
        >
          <Text
            style={[
              styles.tagText,
              chip === 'success' ? { color: '#1F6B45' } : { color: '#5F6B80' },
            ]}
          >
            {tag}
          </Text>
        </View>
      </View>
      <Text style={styles.closedReasonText}>{reason}</Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Short interview time label, e.g. "Tomorrow, 11:00 am" or "Mon 15 Jul, 4:30 pm". */
function formatInterviewShort(iso: string): string {
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
  if (dayDiff > 1 && dayDiff < 7) {
    const weekday = d.toLocaleDateString('en-IN', {
      weekday: 'short',
      timeZone: 'Asia/Kolkata',
    });
    return `${weekday}, ${time}`;
  }
  const date = d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
  return `${date}, ${time}`;
}

/** The one-line reason shown under a closed card. */
function closedReason(app: ApplicationResponse): string {
  switch (app.stage) {
    case 'HIRED':
      return 'You accepted this offer.';
    case 'REJECTED':
      return 'The employer did not select you for this role.';
    case 'WITHDRAWN':
      return 'You withdrew this application.';
    case 'EXPIRED':
      return 'Closed with no response from the employer.';
    default:
      return stageLabel(app.stage);
  }
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
    paddingTop: Spacing.xl,
    paddingBottom: 110,
    gap: 16,
  },
  headerSection: {
    paddingHorizontal: 20,
    gap: 14,
  },
  mainTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.5,
    color: Colors.navy,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
  },
  filterPill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  filterPillActive: {
    backgroundColor: '#5F4DB2',
  },
  filterPillInactive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
  },
  filterPillText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 16,
  },
  filterPillTextActive: {
    color: '#FFFFFF',
  },
  filterPillTextInactive: {
    color: '#3A4761',
  },
  listContainer: {
    paddingHorizontal: 20,
    gap: 12,
  },
  loadingContainer: {
    paddingHorizontal: 20,
    paddingVertical: 40,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    color: '#5F6B80',
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
  loadingMoreRow: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  emptyContainer: {
    paddingHorizontal: 32,
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  emptyIconWell: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#F4EFE4',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: Colors.navy,
    textAlign: 'center',
  },
  emptyBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
    textAlign: 'center',
  },
  findJobsButton: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: '#5F4DB2',
  },
  findJobsButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  appCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 16,
    gap: 12,
  },
  pendingHireCard: {
    borderColor: '#5F4DB2',
    borderWidth: 1.5,
  },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#F1EAF7',
    borderRadius: 12,
    padding: 12,
  },
  pendingBannerIcon: {
    width: 28,
    height: 28,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingBannerText: {
    flex: 1,
    gap: 2,
  },
  pendingBannerTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: '#4A3E8F',
  },
  pendingBannerBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#3A4761',
  },
  reviewButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
  },
  reviewButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  badgeMonogram: {
    width: 40,
    height: 40,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeMonogramText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    lineHeight: 16,
  },
  badgeGray: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#F4EFE4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleInfo: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  roleTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 15,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: Colors.navy,
  },
  roleSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  tag: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  tagText: {
    fontFamily: Platform.select({
      ios: 'SpaceMono-Bold',
      android: 'SpaceMono-Bold',
      default: 'monospace',
    }),
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  progressSection: {
    gap: 8,
    width: '100%',
  },
  progressBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    width: '100%',
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: 999,
  },
  segmentFilled: {
    backgroundColor: '#5E4DB2',
  },
  segmentEmpty: {
    backgroundColor: '#F0EBDF',
  },
  stageLabelRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  stageNumberText: {
    fontFamily: Platform.select({
      ios: 'SpaceMono-Regular',
      android: 'SpaceMono-Regular',
      default: 'monospace',
    }),
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.6,
    color: '#5F6B80',
  },
  stageStatusText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    lineHeight: 14,
    color: '#3A4761',
  },
  interviewActionBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F1EAF7',
    borderRadius: 12,
    padding: 12,
    width: '100%',
  },
  interviewActionText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    lineHeight: 16,
    color: '#0A1931',
  },
  joinButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#5F4DB2',
  },
  joinButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    lineHeight: 16,
    color: '#FFFFFF',
  },
  cardFooterNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0EBDF',
  },
  cardFooterNoticeText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  closedCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 16,
    gap: 10,
  },
  closedReasonText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  cardPressed: {
    transform: [{ scale: 0.99 }],
    opacity: 0.95,
  },
  buttonPressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.9,
  },
});
