import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from 'expo-router';
import {
  Bell,
  ArrowRight,
  TrendUp,
  RocketLaunch,
  Briefcase,
  CaretRight,
  CheckCircle,
  GraduationCap,
  Sparkle,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { BottomTabBar, TabName } from '@/components/navigation/BottomTabBar';
import { StreakCard } from '@/components/cards/StreakCard';
import { useStreak } from '@/hooks/useStreak';
import {
  formatHomeDate,
  greetingFirstName,
  initialsFromName,
  nameFromEmail,
} from '@/services/profile/display';
import { resolveCandidateFullName } from '@/services/profile/name';
import { useAuthContext } from '@/context/AuthContext';
import { getQuestionnaire } from '@/services/api/questionnaire';
import { searchJobs } from '@/services/api/jobs';
import { getInbox } from '@/services/api/notifications';
import { BoardJobSummary } from '@/types/job';
import {
  formatSalaryRangePaise,
  getInitials,
  pickFromString,
} from '@/utils/helpers';

// Monogram background palette (deterministic from employer name).
const MONOGRAM_BG = ['#F1EAF7', '#F7EFD6', '#E6F1EA', '#E7E0D4', '#F8E6E0'];
const MONOGRAM_FG = ['#4A3E8F', '#7A5C0E', '#1F6B45', '#5F6B80', '#993A22'];

/**
 * PARTLY MOCK. `score` and `bandName` are real when the caller has read
 * `GET /candidate/score/me`; the card shows a dash when it has not, rather
 * than a stand-in number.
 *
 * `scoreGain`, `fixesLeft`, `fixesWorth` and `pointsToNextBand` have **no
 * backend source and cannot get one**: the client removed score explanation
 * (2026-08-27, re-confirmed 2026-09-11), so no API returns a delta, a
 * breakdown or an improvement list. Treat them as design placeholders to be
 * removed, not as integration work that is pending.
 *
 * Everything else on this screen (jobs, notifications, add-on cards) still
 * needs wiring to its own endpoints.
 *
 * Name and avatar initials come from `GET /candidate/profile`. The
 * `candidateName` prop is only a seed from sign-up/login so the greeting is
 * not empty while that request is in flight.
 */
export interface HomeScreenProps {
  candidateName?: string;
  candidateInitials?: string;
  currentDate?: string;
  score?: number;
  maxScore?: number;
  bandName?: string;
  bandNumber?: number;
  bandTotal?: number;
  scoreGain?: number;
  fixesLeft?: number;
  fixesWorth?: number;
  pointsToNextBand?: number;
  nextBandName?: string;
  activeTab?: TabName;
  onTabPress?: (tab: TabName, href: string) => void;
  onExploreJobs?: () => void;
  onScorePress?: () => void;
  onAttributeCheckPress?: () => void;
  onMockInterviewPress?: () => void;
  onAllJobsPress?: () => void;
  onJobPress?: (jobId: string) => void;
  onNotificationsPress?: () => void;
  onProfilePress?: () => void;
  onStreakPress?: () => void;
  onCoursesPress?: () => void;
}

export function HomeScreen({
  candidateName,
  candidateInitials,
  currentDate,
  // No default score. It comes from `GET /candidate/score/me`, and the card
  // shows a dash until there is a real one - see the note above.
  score,
  maxScore = 990,
  bandName,
  bandNumber = 1,
  bandTotal = 4,
  scoreGain = 26,
  fixesLeft = 2,
  fixesWorth = 32,
  pointsToNextBand = 28,
  nextBandName = 'Building',
  activeTab = 'home',
  onTabPress,
  onExploreJobs,
  onScorePress,
  onAttributeCheckPress,
  onMockInterviewPress,
  onAllJobsPress,
  onJobPress,
  onNotificationsPress,
  onProfilePress,
  onStreakPress,
  onCoursesPress,
}: HomeScreenProps) {
  // Streak + engagement points. Check-in happens in the hook on app open and
  // on return to foreground; here we only read the result. Engagement points
  // are a SEPARATE balance from the 700–990 candidate score (`docs/streaks.md` §2).
  const { streak, loading: streakLoading } = useStreak();
  const { session, candidateFullName, setCandidateFullName } = useAuthContext();
  // Seed the name with the email's local part so the greeting is never blank
  // while the real profile name is still being fetched or filled in.
  const emailName = nameFromEmail(session?.email);
  const [profileName, setProfileName] = useState<string | null>(
    candidateFullName || candidateName || emailName || null,
  );
  const [questionnaireSubmitted, setQuestionnaireSubmitted] = useState(false);
  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  // 2–3 jobs the candidate is eligible for, from
  // `GET /candidate/jobs?eligible_only=true&limit=3`. Shown on the home
  // dashboard as "Jobs you qualify for". Never tagged with a score delta.
  const [eligibleJobs, setEligibleJobs] = useState<BoardJobSummary[]>([]);

  useEffect(() => {
    const seed = candidateFullName || candidateName || emailName;
    if (seed?.trim()) {
      setProfileName(seed.trim());
    }
  }, [candidateFullName, candidateName, emailName]);

  useEffect(() => {
    let cancelled = false;
    // Reads the stored profile name, and saves one for an account that has
    // none yet - see `services/profile/name.ts`. Falls back to the email's
    // local part if no name can be resolved at all.
    resolveCandidateFullName(candidateFullName || candidateName)
      .then((name) => {
        if (cancelled) return;
        const resolved = name || emailName || null;
        if (resolved) {
          setProfileName(resolved);
          if (name) setCandidateFullName(name);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // Resolved once per mount: it writes, and the seed only narrows the first
    // answer rather than changing it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      getInbox(null, 1)
        .then((page) => {
          if (!cancelled) setHasUnreadNotifications(page.unread > 0);
        })
        .catch(() => undefined);

      return () => {
        cancelled = true;
      };
    }, []),
  );

  useEffect(() => {
    getQuestionnaire()
      .then((questionnaire) =>
        setQuestionnaireSubmitted(questionnaire.submitted),
      )
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Only ELIGIBLE jobs are shown here - the home dashboard never surfaces a
    // "short of the bar" card (R11: the score is never explained).
    searchJobs({ eligible_only: true, limit: 3 })
      .then((page) => {
        if (!cancelled) setEligibleJobs(page.items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const firstName = greetingFirstName(profileName) || 'Priya';
  const initials = candidateInitials || initialsFromName(profileName) || 'PD';
  const dateLabel = currentDate || formatHomeDate();

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Top Header Row */}
          <View style={styles.headerRow}>
            <View style={styles.greetingCol}>
              <Text style={styles.dateText} numberOfLines={1}>{dateLabel}</Text>
              <Text style={styles.greetingText} numberOfLines={1} ellipsizeMode="tail">{`Hi, ${firstName}`}</Text>
            </View>

            <View style={styles.headerActionsRow}>
              {/* Notification Bell Button with Red Badge */}
              <Pressable
                style={({ pressed }) => [
                  styles.iconButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={onNotificationsPress}
                accessibilityRole="button"
                accessibilityLabel="Notifications"
              >
                <Bell size={18} color={Colors.navy} weight="bold" />
                {hasUnreadNotifications && <View style={styles.unreadDot} />}
              </Pressable>

              {/* Profile Avatar Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.avatarButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={onProfilePress}
                accessibilityRole="button"
                accessibilityLabel="Profile"
              >
                <Text style={styles.avatarText}>{initials}</Text>
              </Pressable>
            </View>
          </View>

          {/* Opportunity Hero Card */}
          <View style={styles.heroCard}>
            <View style={styles.heroLeftCol}>
              <Text
                style={styles.heroTitle}
                // The break after "opportunity" is the design. Cap the lines so
                // a narrow screen or a large system font size shrinks the text
                // rather than wrapping it onto a third line.
                numberOfLines={2}
                adjustsFontSizeToFit
                minimumFontScale={0.8}
              >
                Your next opportunity{'\n'}starts here.
              </Text>
              <Text style={styles.heroSubtitle}>
                See where you stand and{'\n'}find roles that fit.
              </Text>
              <Pressable
                style={({ pressed }) => [
                  styles.exploreButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={onExploreJobs}
              >
                <Text style={styles.exploreText}>Explore</Text>
                <ArrowRight size={12} color="#FFFFFF" weight="bold" />
              </Pressable>
            </View>

            <View style={styles.heroRightCol}>
              <Image
                source={require('../../assets/icons/home-hero.jpeg')}
                style={styles.heroImage}
                resizeMode="cover"
              />
            </View>
          </View>

          {/* Your Score Card */}
          <Pressable
            style={({ pressed }) => [
              styles.scoreCard,
              pressed && styles.cardPressed,
            ]}
            onPress={onScorePress}
          >
            {/* Score Top Row */}
            <View style={styles.scoreTopRow}>
              <Text style={styles.scoreEyebrow} numberOfLines={1}>RESUME SCORE</Text>
              <View style={styles.bandBadge}>
                <Text style={styles.bandBadgeText} numberOfLines={1}>
                  {bandName || 'Emerging'}
                </Text>
              </View>
            </View>

            {/* Score Number Row */}
            <View style={styles.scoreNumberRow}>
              <Text
                style={styles.bigScoreText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {score != null ? String(score) : '—'}
              </Text>
              <Text style={styles.maxScoreText} numberOfLines={1}>/ {maxScore}</Text>
              <View style={styles.trendBadge}>
                <TrendUp size={11} color="#FFFFFF" weight="bold" />
                <Text style={styles.trendText} numberOfLines={1}>+{scoreGain}</Text>
              </View>
            </View>

            {/* 4-segment progress bar */}
            <View style={styles.segmentsRow}>
              <View style={[styles.segment, styles.segmentActive]} />
              <View
                style={[
                  styles.segment,
                  (bandNumber ?? 1) >= 2
                    ? styles.segmentActive
                    : styles.segmentInactive,
                ]}
              />
              <View
                style={[
                  styles.segment,
                  (bandNumber ?? 1) >= 3
                    ? styles.segmentActive
                    : styles.segmentInactive,
                ]}
              />
              <View
                style={[
                  styles.segment,
                  (bandNumber ?? 1) >= 4
                    ? styles.segmentActive
                    : styles.segmentInactive,
                ]}
              />
            </View>

            {/* Score Footer Meta Row */}
            <View style={styles.scoreFooterRow}>
              <Text
                style={styles.nextBandText}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.75}
              >
                {`${pointsToNextBand || 28} more to next band!`}
              </Text>
              <ArrowRight size={15} color="#FFFFFF" weight="bold" />
            </View>
          </Pressable>

          {/* Daily Streak - engagement points, separate from the resume score */}
          <StreakCard
            streak={streak}
            loading={streakLoading}
            onPress={onStreakPress}
          />

          {/* "GO FURTHER" Section */}
          <View style={styles.sectionContainer}>
            <View style={styles.sectionEyebrowRow}>
              <RocketLaunch size={12} color="#A87C17" weight="bold" />
              <Text style={styles.sectionEyebrowText}>GO FURTHER</Text>
            </View>

            <View style={styles.featureGrid}>
              {/* Feature 1: Work preferences (commented out as requested) */}
              {/*
              <Pressable
                style={({ pressed }) => [
                  styles.featureCard,
                  styles.attributeCardBg,
                  pressed && styles.cardPressed,
                ]}
                onPress={onAttributeCheckPress}
              >
                <View style={styles.featureImageContainer}>
                  <Image
                    source={require('../../assets/icons/card-attr.png')}
                    style={styles.featureImage}
                  />
                  <View style={styles.freeBadge}>
                    <Text style={styles.freeBadgeText}>FREE</Text>
                  </View>
                </View>
                <View style={styles.featureInfo}>
                  <Text style={styles.featureTitle}>Work preferences</Text>
                  <Text style={styles.featureMeta}>
                    {questionnaireSubmitted
                      ? 'View your answers'
                      : 'About 12 questions'}
                  </Text>
                </View>
              </Pressable>
              */}

              {/* Feature 1: Certified Skill Courses (adjusted in place of work preferences) */}
              <Pressable
                style={({ pressed }) => [
                  styles.featureCard,
                  styles.courseCardBg,
                  pressed && styles.cardPressed,
                ]}
                onPress={onCoursesPress}
                accessibilityRole="button"
                accessibilityLabel="Certified skill courses"
              >
                <View style={styles.featureImageContainer}>
                  <Image
                    source={require('../../assets/icons/card-course.png')}
                    style={styles.featureImage}
                  />
                  <View style={styles.courseBadge}>
                    <Sparkle size={9} color="#FFFFFF" weight="fill" />
                    <Text style={styles.courseBadgeText}>+30 BOOST</Text>
                  </View>
                </View>
                <View style={styles.featureInfo}>
                  <Text style={styles.featureTitle} numberOfLines={1}>
                    Skill courses
                  </Text>
                  <Text style={styles.featureMeta} numberOfLines={1}>
                    Certified modules
                  </Text>
                </View>
              </Pressable>

              {/* Feature 2: Mock interview */}
              <Pressable
                style={({ pressed }) => [
                  styles.featureCard,
                  styles.mockCardBg,
                  pressed && styles.cardPressed,
                ]}
                onPress={onMockInterviewPress}
              >
                <View style={styles.featureImageContainer}>
                  <Image
                    source={require('../../assets/icons/card-mock.png')}
                    style={styles.featureImage}
                  />
                  <View style={styles.priceBadge}>
                    <Text style={styles.priceBadgeText}>₹299</Text>
                  </View>
                </View>
                <View style={styles.featureInfo}>
                  <Text style={styles.featureTitle} numberOfLines={1}>
                    Mock interview
                  </Text>
                  <Text style={styles.featureMeta} numberOfLines={1}>
                    6 questions · 15 min
                  </Text>
                </View>
              </Pressable>
            </View>

            {/* Feature 3: Skill Courses Promo Banner - commented out since skill courses are now adjusted in the featureGrid above */}
            {/*
            <Pressable
              style={({ pressed }) => [
                styles.coursePromoCard,
                pressed && styles.cardPressed,
              ]}
              onPress={onCoursesPress}
              accessibilityRole="button"
              accessibilityLabel="Explore skill courses"
            >
              <View style={styles.coursePromoLeft}>
                <View style={styles.coursePromoHeader}>
                  <View style={styles.coursePromoIconWrap}>
                    <GraduationCap size={16} color="#FFFFFF" weight="fill" />
                  </View>
                  <View style={styles.courseBoostBadge}>
                    <Sparkle size={10} color="#92400E" weight="fill" />
                    <Text style={styles.courseBoostBadgeText}>+30 SCORE BOOST</Text>
                  </View>
                </View>
                <Text style={styles.coursePromoTitle}>Certified Skill Courses</Text>
                <Text style={styles.coursePromoBody}>
                  Complete video modules to boost your score & stand out to employers
                </Text>
              </View>
              <View style={styles.coursePromoCaret}>
                <CaretRight size={16} color="#5F4DB2" weight="bold" />
              </View>
            </Pressable>
            */}
          </View>

          {/* "JOBS YOU QUALIFY FOR" Section */}
          <View style={styles.sectionContainer}>
            <View style={styles.jobsHeaderRow}>
              <View style={styles.sectionEyebrowRow}>
                <Briefcase size={12} color="#A87C17" weight="bold" />
                <Text style={styles.sectionEyebrowText}>
                  JOBS YOU QUALIFY FOR
                </Text>
              </View>

              <Pressable style={styles.allJobsButton} onPress={onAllJobsPress}>
                <Text style={styles.allJobsText}>See all</Text>
                <CaretRight size={12} color={Colors.navy} weight="bold" />
              </Pressable>
            </View>

            {eligibleJobs.length === 0 ? (
              <View style={styles.jobsEmptyState}>
                <Text style={styles.jobsEmptyTitle}>
                  No eligible jobs right now
                </Text>
                <Text style={styles.jobsEmptyBody}>
                  Keep your profile and resume up to date - new roles that fit
                  you will show up here.
                </Text>
              </View>
            ) : (
              eligibleJobs.map((job) => {
                const employer = job.employer_name || 'Employer';
                const monogram = getInitials(employer);
                const bg = pickFromString(employer, MONOGRAM_BG);
                const fg = pickFromString(employer, MONOGRAM_FG);
                return (
                  <Pressable
                    key={job.id}
                    style={({ pressed }) => [
                      styles.jobCard,
                      pressed && styles.cardPressed,
                    ]}
                    onPress={() => onJobPress?.(job.id)}
                  >
                    <View
                      style={[styles.companyMonogram, { backgroundColor: bg }]}
                    >
                      <Text style={[styles.monogramText, { color: fg }]}>
                        {monogram}
                      </Text>
                    </View>

                    <View style={styles.jobInfoCol}>
                      <Text style={styles.jobTitleText} numberOfLines={1}>
                        {job.title}
                      </Text>
                      <Text style={styles.jobCompanyText} numberOfLines={1}>
                        {employer}
                        {job.location ? ` · ${job.location}` : ''}
                      </Text>
                      <Text style={styles.jobSalaryText}>
                        {formatSalaryRangePaise(
                          job.salary_min_minor,
                          job.salary_max_minor,
                        )}
                        /mo
                      </Text>
                    </View>

                    {/* "Eligible" tag - never "MATCH" with a number, never a
                       "short by N" badge (R11). */}
                    <View style={styles.eligibleBadge}>
                      <CheckCircle size={12} color="#1F6B45" weight="fill" />
                      <Text style={styles.eligibleBadgeText}>Eligible</Text>
                    </View>
                  </Pressable>
                );
              })
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Floating Bottom Tab Bar */}
      <BottomTabBar
        activeTab={activeTab}
        onTabPress={(tab, href) => onTabPress?.(tab, href)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFCF7', // Brand Canvas
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg, // 20px
    paddingTop: Spacing.md, // 12px
    paddingBottom: 110, // Room for floating tab bar and full scroll
    gap: Spacing.lg, // 20px
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  greetingCol: {
    flex: 1,
    marginRight: Spacing.md,
    gap: 2,
  },
  dateText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 16,
    color: '#5F6B80',
  },
  greetingText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.6,
    color: Colors.navy, // #0A1931
  },
  headerActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  iconButton: {
    position: 'relative',
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E7E0D4',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadDot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#B23A1E',
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
  },
  avatarButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    lineHeight: 16,
    color: '#FFFCF7',
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  cardPressed: {
    opacity: 0.92,
    transform: [{ scale: 0.99 }],
  },
  heroCard: {
    backgroundColor: '#D4CAE7',
    borderWidth: 1,
    borderColor: '#C3B7DE',
    borderRadius: 24,
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'stretch',
    height: 164,
    position: 'relative',
  },
  heroLeftCol: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 18,
    paddingRight: 4,
    paddingVertical: 18,
    flexDirection: 'column',
    gap: 8,
    zIndex: 2,
  },
  heroTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 20,
    lineHeight: 23,
    letterSpacing: -0.6,
    color: Colors.navy, // #0A1931
  },
  heroSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: 'rgba(10, 25, 49, 0.72)',
  },
  exploreButton: {
    // margin-top:auto pushes the button to the bottom of the column, matching
    // the prototype (title + subtitle at top, button at bottom - not centered).
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#5F4DB2',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: Radii.pill, // 999
    marginTop: 'auto',
  },
  exploreText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 16,
    color: '#FFFFFF',
  },
  heroRightCol: {
    width: 142,
    height: '100%',
    overflow: 'hidden',
    position: 'relative',
  },
  heroImage: {
    // Matches the prototype crop: a 200×241 image in a 142px column, offset
    // left/top so the figure fills the column and clips the overflow.
    width: 200,
    height: 241,
    position: 'absolute',
    left: -39,
    top: -40,
    resizeMode: 'cover',
  },
  scoreCard: {
    backgroundColor: '#5F4DB2',
    borderRadius: 24,
    padding: 20,
    gap: 12,
  },
  scoreTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    flexWrap: 'nowrap',
  },
  scoreEyebrow: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 13,
    letterSpacing: 1.5,
    color: '#F1EAF7',
  },
  scoreNumberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
    marginBottom: 2,
    flexWrap: 'nowrap',
  },
  bigScoreText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 44,
    lineHeight: 46,
    letterSpacing: -1.8,
    color: '#FFFFFF',
    includeFontPadding: false,
  },
  maxScoreText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 16,
    color: '#F1EAF7',
    includeFontPadding: false,
    marginTop: 8,
  },
  trendBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    backgroundColor: 'rgba(255, 252, 247, 0.18)',
    marginTop: 8,
  },
  trendText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 14,
    color: '#FFFFFF',
  },
  bandBadge: {
    paddingHorizontal: 11,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    backgroundColor: '#F4D685',
  },
  bandBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 12,
    lineHeight: 15,
    color: '#0A1931',
  },
  segmentsRow: {
    flexDirection: 'row',
    gap: 4,
    width: '100%',
    marginVertical: 4,
  },
  segment: {
    flex: 1,
    height: 5,
    borderRadius: Radii.pill,
  },
  segmentActive: {
    backgroundColor: '#F4D685',
  },
  segmentInactive: {
    backgroundColor: 'rgba(255, 252, 247, 0.22)',
  },
  scoreFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 2,
    flexWrap: 'nowrap',
    gap: 8,
  },
  nextBandText: {
    flex: 1,
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 17,
    color: '#FFFFFF',
  },
  sectionContainer: {
    gap: 12,
  },
  sectionEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionEyebrowText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 1.5,
    color: '#5F6B80',
  },
  featureGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  featureCard: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderRadius: 20,
    padding: 10,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  attributeCardBg: {
    backgroundColor: '#DDD6F2',
    borderColor: '#CDC4EA',
  },
  courseCardBg: {
    backgroundColor: '#DDD6F2',
    borderColor: '#CDC4EA',
  },
  mockCardBg: {
    backgroundColor: '#CFD8ED',
    borderColor: '#BDC8E3',
  },
  featureImageContainer: {
    // Fixed height (not aspectRatio) so the image area stays the same size
    // regardless of card width - matches the prototype's 100px. With
    // aspectRatio the box shrank on narrow cards, making the image tiny.
    width: '100%',
    height: 100,
    borderRadius: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  featureImage: {
    // cover (not contain) so the illustration fills the box edge-to-edge,
    // matching the prototype's object-fit: cover.
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  freeBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    backgroundColor: '#5F4DB2',
  },
  freeBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.6,
    color: '#FFFFFF',
  },
  courseBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    backgroundColor: '#5F4DB2',
  },
  courseBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.6,
    color: '#FFFFFF',
  },
  priceBadge: {
    position: 'absolute',
    top: 5,
    right: 5,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    backgroundColor: '#5F4DB2',
  },
  priceBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.6,
    color: '#FFFFFF',
  },
  featureInfo: {
    paddingTop: 12,
    paddingHorizontal: 6,
    paddingBottom: 6,
    gap: 4,
  },
  featureTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: Colors.navy, // #0A1931
  },
  featureMeta: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  jobsHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  allJobsButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  allJobsText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 16,
    color: Colors.navy,
  },
  jobCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  companyMonogram: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F1EAF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monogramText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    lineHeight: 16,
    color: '#4A3E8F',
  },
  jobInfoCol: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  jobTitleText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
  },
  jobCompanyText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  jobSalaryText: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.navy,
    marginTop: 2,
  },
  matchBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    backgroundColor: '#E6F1EA',
  },
  matchBadgeText: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.6,
    color: '#1F6B45',
  },
  shortBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    backgroundColor: '#F7EFD6',
  },
  shortBadgeText: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.6,
    color: '#7A5C0E',
  },
  eligibleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: Radii.pill,
    backgroundColor: '#E6F1EA',
  },
  eligibleBadgeText: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.6,
    color: '#1F6B45',
  },
  jobsEmptyState: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 20,
    gap: 6,
  },
  jobsEmptyTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
  },
  jobsEmptyBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#5F6B80',
  },
  coursePromoCard: {
    backgroundColor: '#F3EFFF',
    borderWidth: 1,
    borderColor: '#D8CEF8',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  coursePromoLeft: {
    flex: 1,
    gap: 4,
  },
  coursePromoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  coursePromoIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  courseBoostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
  },
  courseBoostBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    lineHeight: 12,
    color: '#92400E',
    letterSpacing: 0.5,
  },
  coursePromoTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
  },
  coursePromoBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  coursePromoCaret: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2D9F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
