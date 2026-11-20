/**
 * BharatPath - JobsFeedScreen ("Jobs" Tab Screen)
 *
 * Implements S17 (Job feed) from `docs/screen-flows.md`, wired to the real
 * backend `GET /candidate/jobs`.
 *
 * Key rules enforced here (R11 / invariants):
 *  - NO "28 matches / 706 / 734 unlock" banner. Replaced with a count-free
 *    "Only jobs I can apply to" toggle (`eligible_only`).
 *  - NO total count anywhere. The board returns `total: null`; we use
 *    `next_cursor` for infinite scroll and never render "Showing X of Y".
 *  - Each card shows an `eligibility` chip: ELIGIBLE → ✓ "You can apply",
 *    BELOW_THRESHOLD → "Not eligible" (neutral grey, NOT red),
 *    SCORE_PENDING → "Score updating".
 *  - Money is integer paise from the backend; converted to ₹ for display.
 *  - Experience is in months; shown as years.
 */
import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  RefreshControl,
  Image,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  MapPin,
  SlidersHorizontal,
  MagnifyingGlass,
  CaretRight,
  CheckCircle,
  Clock,
  Briefcase,
  XCircle,
  SpinnerGap,
  X,
} from 'phosphor-react-native';
import { Colors, Spacing } from '@/theme/tokens';
import { BottomTabBar, TabName } from '@/components/navigation/BottomTabBar';
import { JobFiltersSheet } from '@/screens/jobs/JobFiltersSheet';
import { useJobs } from '@/hooks/useJobs';
import { NotificationButton } from '@/components/navigation/NotificationButton';
import { useJobApplications } from '@/hooks/useJobApplications';
import { type ApplicationStage } from '@/types/application';
import { jobApplicationStatus } from '@/utils/jobApplicationStatus';
import type { JobCarouselLayout } from '@/utils/jobCarouselLayout';
import { useFocusEffect } from 'expo-router';
import { BoardJobSummary, EligibilityStatus, JobFilters } from '@/types/job';
import {
  formatSalaryRangePaise,
  formatExperienceMonths,
  workModeLabel,
  formatPostedAgo,
  getInitials,
  pickFromString,
} from '@/utils/helpers';

// Text strings extracted as constants so the JSX contains no literal
// apostrophes (react/no-unescaped-entities).
const TXT_ALL_CAUGHT_UP = "You're all caught up";
const TXT_NO_JOBS_SUB = "We'll tell you when one opens.";

export interface JobsFeedScreenProps {
  activeTab?: TabName;
  onTabPress?: (tab: TabName, href: string) => void;
  /** Called with the job id when a card is tapped. */
  onJobPress?: (jobId: string) => void;
  /** Candidate's declared city, for the header. Optional. */
  candidateCity?: string | null;
}

// Monogram background palette (deterministic from employer name).
const MONOGRAM_BG = ['#F1EAF7', '#F7EFD6', '#E6F1EA', '#E7E0D4', '#F8E6E0'];
const MONOGRAM_FG = ['#4A3E8F', '#7A5C0E', '#1F6B45', '#5F6B80', '#993A22'];

export function JobsFeedScreen({
  activeTab = 'jobs',
  onTabPress,
  onJobPress,
  candidateCity,
}: JobsFeedScreenProps) {
  const {
    jobs,
    loading,
    loadingMore,
    hasReachedEnd,
    error,
    loadMore,
    setSearch,
    search,
    setFilters,
    filters,
    hasActiveFilters,
    reset,
    reload,
  } = useJobs();
  const applications = useJobApplications();
  const reloadApplications = applications.reload;
  const latestReload = useRef(reload);
  latestReload.current = reload;
  const focusedBefore = useRef(false);
  useFocusEffect(useCallback(() => {
    if (focusedBefore.current) void latestReload.current();
    focusedBefore.current = true;
  }, []));

  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const handleJobPress = useCallback(
    (jobId: string) => {
      onJobPress?.(jobId);
    },
    [onJobPress],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([reload(), reloadApplications()]);
    setRefreshing(false);
  }, [reload, reloadApplications]);

  const handleApplyFilters = useCallback(
    (next: JobFilters) => {
      setFilters(next);
    },
    [setFilters],
  );

  const handleResetFilters = useCallback(() => {
    reset();
  }, [reset]);

  const renderFooter = () => {
    if (loadingMore) {
      return (
        <View style={styles.footerLoading}>
          <ActivityIndicator size="small" color={Colors.brandAccent} />
        </View>
      );
    }
    if (hasReachedEnd && jobs.length > 0) {
      return (
        <View style={styles.footerEnd}>
          <Text style={styles.footerEndText}>{TXT_ALL_CAUGHT_UP}</Text>
        </View>
      );
    }
    return null;
  };

  const renderEmpty = () => {
    if (loading) return null; // shown by the overlay instead
    if (error) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{error}</Text>
          <Pressable
            style={({ pressed }) => [
              styles.retryBtn,
              pressed && styles.btnPressed,
            ]}
            onPress={reload}
          >
            <Text style={styles.retryBtnText}>Try again</Text>
          </Pressable>
        </View>
      );
    }
    if (hasActiveFilters || search.trim()) {
      return (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>No jobs match these filters</Text>
          <Pressable
            style={({ pressed }) => [
              styles.retryBtn,
              pressed && styles.btnPressed,
            ]}
            onPress={handleResetFilters}
          >
            <Text style={styles.retryBtnText}>Reset filters</Text>
          </Pressable>
        </View>
      );
    }
    return (
      <View style={styles.emptyState}>
        <View style={styles.emptyIcon}>
          <Briefcase size={24} color={Colors.brandAccent} weight="duotone" />
        </View>
        <Text style={styles.emptyTitle}>No jobs in your area yet.</Text>
        <Text style={styles.emptySubtitle}>{TXT_NO_JOBS_SUB}</Text>
        <Pressable
          style={({ pressed }) => [styles.emptyActionBtn, pressed && styles.btnPressed]}
          onPress={() => setIsFilterSheetOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Change job filters"
        >
          <SlidersHorizontal size={16} color={Colors.brandAccent} weight="bold" />
          <Text style={styles.emptyActionText}>Change filters</Text>
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Fixed header (does not scroll with the list) */}
        <View style={styles.headerSection}>
          <View style={styles.topRow}>
            <View style={styles.titleCol}>
              <Text style={styles.mainTitle}>Jobs</Text>
              <View style={styles.locationRow}>
                <MapPin size={13} color="#5F6B80" weight="bold" />
                <Text style={styles.locationText}>
                  {candidateCity ? candidateCity : 'India'}
                </Text>
              </View>
            </View>

            {/* Top action button: Filter */}
            <View style={styles.topActionsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.filterIconBtn,
                  pressed && styles.btnPressed,
                ]}
                onPress={() => setIsFilterSheetOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Open job filters"
              >
                <SlidersHorizontal size={18} color={Colors.navy} weight="bold" />
                {hasActiveFilters && <View style={styles.goldBadgeDot} />}
              </Pressable>
              <NotificationButton />
            </View>
          </View>

          {/* Search bar */}
          <View style={styles.searchBar}>
            <MagnifyingGlass size={16} color="#5F6B80" weight="bold" />
            <TextInput
              style={styles.searchInput}
              placeholder="Role, company or skill"
              placeholderTextColor="#566073"
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
              autoCorrect={false}
              autoCapitalize="none"
            />
            {search.length > 0 && (
              <Pressable
                hitSlop={8}
                onPress={() => setSearch('')}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <X size={16} color="#5F6B80" weight="bold" />
              </Pressable>
            )}
          </View>

        </View>

        {/* Job list with infinite scroll */}
        <FlatList
          data={jobs}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <JobCard job={item} onPress={() => handleJobPress(item.id)}
              applicationStage={applications.byJob[item.id]?.stage ?? item.application_stage}
              statusLoading={applications.loading && !applications.byJob[item.id] && item.application_stage === undefined}
              statusError={applications.error && !applications.byJob[item.id] && item.application_stage === undefined} />
          )}
          contentContainerStyle={[
            styles.listContent,
            jobs.length === 0 && styles.listContentEmpty,
          ]}
          ItemSeparatorComponent={() => <View style={styles.cardGap} />}
          ListFooterComponent={renderFooter}
          ListEmptyComponent={renderEmpty}
          onEndReached={() => loadMore()}
          onEndReachedThreshold={0.4}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor={Colors.brandAccent}
              colors={[Colors.brandAccent]}
            />
          }
        />

        {/* First-load loading overlay */}
        {loading && jobs.length === 0 && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color={Colors.brandAccent} />
          </View>
        )}
      </SafeAreaView>

      {/* Filter bottom sheet */}
      <JobFiltersSheet
        visible={isFilterSheetOpen}
        onClose={() => setIsFilterSheetOpen(false)}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
        currentFilters={filters}
      />


      {/* Floating bottom tab bar */}
      {onTabPress && (
        <BottomTabBar activeTab={activeTab} onTabPress={onTabPress} />
      )}
    </View>
  );
}

// ─── Job Card ──────────────────────────────────────────────────

interface JobCardProps {
  job: BoardJobSummary;
  onPress: () => void;
  applicationStage?: ApplicationStage | null;
  statusLoading?: boolean;
  statusError?: boolean;
  style?: StyleProp<ViewStyle>;
  carouselLayout?: JobCarouselLayout;
}

export function JobCard({ job, onPress, applicationStage, statusLoading, statusError, style, carouselLayout }: JobCardProps) {
  const status = jobApplicationStatus(job.eligibility, applicationStage, statusLoading, statusError);
  const employerName = job.employer_name || 'Employer';
  const initials = getInitials(employerName);
  const bg = pickFromString(employerName, MONOGRAM_BG);
  const fg = pickFromString(employerName, MONOGRAM_FG);

  return (
    <Pressable
      style={({ pressed }) => [styles.jobCard, style, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${job.title} at ${employerName}. ${status.label}`}
    >
      <View style={[styles.jobCardTop, carouselLayout && { height: carouselLayout.header, flexShrink: 0 }]}>
        <View style={[styles.badge, { backgroundColor: bg }]}>
          {job.employer_logo_url ? (
            <Image
              source={{ uri: job.employer_logo_url }}
              style={styles.badgeImage}
              resizeMode="cover"
            />
          ) : (
            <Text style={[styles.badgeText, { color: fg }]}>{initials}</Text>
          )}
        </View>
        <View style={styles.jobInfo}>
          <Text style={styles.jobTitle} numberOfLines={2} ellipsizeMode="tail">
            {job.title}
          </Text>
          <Text style={styles.companyName} numberOfLines={1} ellipsizeMode="tail">
            {employerName}
          </Text>
        </View>
      </View>

      <View style={[styles.jobStatusRow, carouselLayout && { height: carouselLayout.status, flexShrink: 0 }]}>
        {applicationStage ? <View style={[styles.chipPending, applicationStage === 'HIRED' && styles.chipEligible]}><CheckCircle size={12} color={applicationStage === 'HIRED' ? Colors.green.fg : '#5F4DB2'} weight="fill"/><Text style={styles.chipPendingText} numberOfLines={carouselLayout ? 1 : undefined}>{status.label}</Text></View>
          : status.kind === 'unknown' ? <View style={styles.chipBelow}><Text style={styles.chipBelowText} numberOfLines={carouselLayout ? 1 : undefined}>{status.label}</Text></View>
          : <EligibilityChip eligibility={job.eligibility} singleLine={!!carouselLayout} />}
      </View>

      {carouselLayout ? <Text style={[styles.metaText, { height: carouselLayout.metadata, flexShrink: 0 }]} numberOfLines={2} ellipsizeMode="tail">
        <Text style={styles.salaryText}>{job.salary_disclosed === false ? 'Salary not disclosed' : formatSalaryRangePaise(job.salary_min_minor, job.salary_max_minor)}{job.salary_disclosed !== false && <Text style={styles.salaryPerMo}>/mo</Text>}</Text>
        {[job.location, job.work_mode ? workModeLabel(job.work_mode) : null, job.experience_min_months != null ? job.experience_min_months === 0 ? 'Freshers welcome' : formatExperienceMonths(job.experience_min_months) : null].filter(Boolean).map(value => ` · ${value}`).join('')}
      </Text> : <View style={styles.metaRow}>
        <Text style={styles.salaryText}>
          {job.salary_disclosed === false ? 'Salary not disclosed' : formatSalaryRangePaise(job.salary_min_minor, job.salary_max_minor)}
          {job.salary_disclosed !== false && <Text style={styles.salaryPerMo}>/mo</Text>}
        </Text>
        {job.location ? (
          <>
            <View style={styles.dot} />
            <Text style={styles.metaText} numberOfLines={1}>
              {job.location}
            </Text>
          </>
        ) : null}
        {job.work_mode ? (
          <>
            <View style={styles.dot} />
            <Text style={styles.metaText}>{workModeLabel(job.work_mode)}</Text>
          </>
        ) : null}
        {job.experience_min_months != null ? (
          <>
            <View style={styles.dot} />
            <Text style={styles.metaText}>
              {job.experience_min_months === 0 ? 'Freshers welcome' : formatExperienceMonths(job.experience_min_months)}
            </Text>
          </>
        ) : null}
      </View>}

      {carouselLayout ? <View style={{ height: carouselLayout.skills, gap: 6, flexShrink: 0 }}>
        {job.skills.length ? [job.skills.slice(0, 2), job.skills.slice(2, 4)].map((row, index) => row.length > 0 && <View key={index} style={styles.carouselSkillsRow}>
          {row.map(skill => <View key={skill} style={[styles.skillChip, styles.carouselSkillChip]}><Text style={styles.skillChipText} numberOfLines={1} ellipsizeMode="tail">{skill}</Text></View>)}
          {index === 1 && job.skills.length > 4 && <Text style={[styles.skillsMore, { flexShrink: 0 }]}>+{job.skills.length - 4}</Text>}
        </View>) : <Text style={styles.metaText}>Skills not specified</Text>}
      </View> : job.skills.length > 0 && (
        <View style={styles.skillsRow}>
          {job.skills.slice(0, 4).map((skill) => (
            <View key={skill} style={styles.skillChip}>
              <Text style={styles.skillChipText} numberOfLines={1}>
                {skill}
              </Text>
            </View>
          ))}
          {job.skills.length > 4 && (
            <Text style={styles.skillsMore}>+{job.skills.length - 4}</Text>
          )}
        </View>
      )}

      <View style={[styles.jobCardFooter, carouselLayout && { height: carouselLayout.footer, flexShrink: 0 }]}>
        <Clock size={13} color="#5F6B80" weight="bold" />
        <Text style={styles.footerPostedText} numberOfLines={carouselLayout ? 1 : undefined}>
          {formatPostedAgo(job.published_at)}
        </Text>
        <CaretRight size={13} color="#5F6B80" weight="bold" />
      </View>
    </Pressable>
  );
}

// ─── Eligibility Chip ──────────────────────────────────────────

interface EligibilityChipProps {
  eligibility: EligibilityStatus;
  singleLine?: boolean;
}

function EligibilityChip({ eligibility, singleLine }: EligibilityChipProps) {
  switch (eligibility) {
    case 'ELIGIBLE':
      return (
        <View style={styles.chipEligible}>
          <CheckCircle size={12} color={Colors.green.fg} weight="fill" />
          <Text style={styles.chipEligibleText} numberOfLines={singleLine ? 1 : undefined}>You can apply</Text>
        </View>
      );
    case 'BELOW_THRESHOLD':
      // Neutral grey, NOT red (R11 - never shame the score).
      return (
        <View style={styles.chipBelow}>
          <XCircle size={12} color="#5F6B80" weight="bold" />
          <Text style={styles.chipBelowText} numberOfLines={singleLine ? 1 : undefined}>Not eligible</Text>
        </View>
      );
    case 'SCORE_PENDING':
      return (
        <View style={styles.chipPending}>
          <SpinnerGap size={12} color="#5F6B80" weight="bold" />
          <Text style={styles.chipPendingText} numberOfLines={singleLine ? 1 : undefined}>Bharatpath Score updating</Text>
        </View>
      );
    default:
      return null;
  }
}

// ─── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.offWhite,
  },
  safeArea: {
    flex: 1,
  },
  headerSection: {
    paddingHorizontal: 20,
    paddingTop: Spacing.lg,
    paddingBottom: 16,
    gap: 16,
    backgroundColor: Colors.offWhite,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  titleCol: {
    flex: 1,
    gap: 2,
  },
  mainTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.5,
    color: Colors.navy,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 16,
    color: '#5F6B80',
  },
  topActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filterIconBtn: {
    position: 'relative',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  goldBadgeDot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.gold,
    borderWidth: 1.5,
    borderColor: Colors.offWhite,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.surface.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    minHeight: 52,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
    padding: 0,
  },
  listContent: {
    paddingHorizontal: 20,
    paddingTop: 2,
    paddingBottom: 110, // space for floating bottom tab bar
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  cardGap: {
    height: 12,
  },
  jobCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.surface.border,
    borderRadius: 20,
    padding: 18,
    gap: 16,
  },
  jobCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  badgeImage: {
    width: 48,
    height: 48,
    borderRadius: 14,
  },
  badgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    lineHeight: 16,
  },
  jobInfo: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  jobStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    flexWrap: 'wrap',
  },
  jobTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: Colors.navy,
  },
  companyName: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 16,
    color: '#5F6B80',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 6,
    flexWrap: 'wrap',
  },
  salaryText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 18,

    color: Colors.navy,
  },
  salaryPerMo: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 18,
    color: '#5F6B80',
    fontWeight: '400',
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#B5AC96',
  },
  metaText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  skillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  carouselSkillsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  carouselSkillChip: { maxWidth: '100%', flexShrink: 1, minWidth: 0 },
  skillChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: Colors.surface.tint,
    borderWidth: 1,
    borderColor: Colors.surface.hairline,
  },
  skillChipText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.text.primary,
  },
  skillsMore: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  jobCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.hairline,
  },
  footerPostedText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  // Eligibility chips
  chipEligible: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.green.bg,
    alignSelf: 'flex-start',
  },
  chipEligibleText: { fontFamily: 'GeneralSans-Medium', fontSize: 12, lineHeight: 17, flexShrink: 1, color: '#1F6B45' },
  chipBelow: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F0EBDF',
    alignSelf: 'flex-start',
  },
  chipBelowText: { fontFamily: 'GeneralSans-Medium', fontSize: 12, lineHeight: 17, flexShrink: 1, color: '#5F6B80' },
  chipPending: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: '#F0EBDF',
    alignSelf: 'flex-start',
  },
  chipPendingText: { fontFamily: 'GeneralSans-Medium', fontSize: 12, lineHeight: 17, flexShrink: 1, color: '#5F6B80' },
  // Empty / error states
  emptyState: {
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.indigoSemantic.bg,
  },
  emptyTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 22,
    color: Colors.navy,
    textAlign: 'center',
  },
  emptySubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#5F6B80',
    textAlign: 'center',
  },
  emptyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#C9BEEB',
    backgroundColor: '#FFFFFF',
  },
  emptyActionText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 18,
    color: Colors.brandAccent,
  },
  retryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: Colors.brandAccent,
  },
  retryBtnText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  // Loading
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 252, 247, 0.7)',
  },
  footerLoading: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  footerEnd: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  footerEndText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  // Press states
  cardPressed: {
    transform: [{ scale: 0.99 }],
    opacity: 0.95,
  },
  btnPressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.9,
  },
});
