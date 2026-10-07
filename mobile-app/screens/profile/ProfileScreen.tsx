/**
 * BharatPath - ProfileScreen ("You" Screen)
 *
 * Shows the candidate's real profile data from the backend:
 *   - Name and location (city, state) from `GET /candidate/profile`
 *   - Score + band from `GET /candidate/score/me` (dash while PENDING)
 *   - Applied count from `GET /candidate/applications`
 *   - Add-ons count (completed courses + completed interview sessions)
 *
 * The profile response carries no phone number, so the subtitle is the
 * location only. The score is never invented - a dash means "still
 * computing" and is the honest state while the scoring worker runs.
 *
 * Sections:
 * - MY INFORMATION (Profile details, Attribute report, Interview report, Language)
 * - PRIVACY AND DATA (Who has seen me, Download my data, Delete my account)
 * - Sticky bottom tab bar with "You" tab active
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  UserCircle,
  LockKey,
  CaretRight,
  FileText,
  Compass,
  MicrophoneStage,
  Translate,
  Eye,
  DownloadSimple,
  SignOut,
  GraduationCap,
  CreditCard,
} from 'phosphor-react-native';
import { Colors, Spacing } from '@/theme/tokens';
import { BottomTabBar, TabName } from '@/components/navigation/BottomTabBar';

export interface ProfileScreenProps {
  /** Candidate's full name from `candidate_profiles.full_name`. */
  name?: string;
  /** Avatar initials, derived from the name. */
  initials?: string;
  /** "City, ST" subtitle from `GET /candidate/profile`. No phone number. */
  locationLabel?: string;
  /** Score band label (e.g. "Solid"). Currently unused on this card - the
   *  score card shows only the number, not the band. Kept on the props for
   *  callers that still pass it. */
  bandName?: string;
  /** Real score value. Undefined while PENDING or on error - show a dash. */
  score?: number;
  /** True while the score is still being computed (PENDING) or loading. */
  scorePending?: boolean;
  /** Number of applications. Undefined while loading; 0 is a real zero. */
  appliedCount?: number;
  /** Completed courses + completed interview sessions. Undefined while loading. */
  addonsCount?: number;
  /** Candidate's subscription state ('ACTIVE', 'NONE', etc.) */
  subscriptionState?: string;
  /** True if the candidate has active paid subscription access */
  hasSubscriptionAccess?: boolean;
  activeTab?: TabName;
  onTabPress?: (tab: TabName, href: string) => void;
  onScorePress?: () => void;
  onAppliedPress?: () => void;
  onAddonsPress?: () => void;
  onResumeDetailsPress?: () => void;
  onResumeReviewPress?: () => void;
  onSubscriptionPress?: () => void;
  onAttributeReportPress?: () => void;
  onInterviewReportPress?: () => void;
  onCoursesPress?: () => void;
  onLanguagePress?: () => void;
  onWhoHasSeenMePress?: () => void;
  onDownloadDataPress?: () => void;
  onLogoutPress?: () => void;
  /** @deprecated Use onLogoutPress */
  onDeleteAccountPress?: () => void;
}

export function ProfileScreen({
  name,
  initials,
  locationLabel,
  bandName,
  score,
  scorePending = true,
  appliedCount,
  addonsCount,
  subscriptionState,
  hasSubscriptionAccess,
  activeTab = 'you',
  onTabPress,
  onScorePress,
  onAppliedPress,
  onAddonsPress,
  onResumeDetailsPress,
  onResumeReviewPress,
  onSubscriptionPress,
  onAttributeReportPress,
  onInterviewReportPress,
  onCoursesPress,
  onLanguagePress,
  onWhoHasSeenMePress,
  onDownloadDataPress,
  onLogoutPress,
  onDeleteAccountPress,
}: ProfileScreenProps) {
  const handleLogout = onLogoutPress || onDeleteAccountPress;
  const insets = useSafeAreaInsets();
  const displayName = name?.trim() || 'Candidate';
  const displayInitials = initials?.trim() || '?';
  const scoreDisplay = score != null ? String(score) : '-';
  const appliedDisplay = appliedCount != null ? String(appliedCount) : '-';
  const addonsDisplay = addonsCount != null ? String(addonsCount) : '-';
  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: 130 + Math.max(insets.bottom, 24) },
          ]}
          showsVerticalScrollIndicator={false}
        >
          {/* Header with avatar badge and candidate info */}
          <View style={styles.header}>
            <View style={styles.avatarBadge}>
              <Text style={styles.avatarText}>{displayInitials}</Text>
            </View>
            <View style={styles.userInfo}>
              <Text style={styles.userName}>{displayName}</Text>
              {locationLabel ? (
                <Text style={styles.userSub}>{locationLabel}</Text>
              ) : null}
            </View>
          </View>

          {/* 3 Stat Cards: Score, Applied, Add-ons */}
          <View style={styles.statsRow}>
            {/* Dark Score Card - real value when READY, dash while PENDING */}
            <Pressable
              style={({ pressed }) => [
                styles.statCardDark,
                pressed && styles.cardPressed,
              ]}
              onPress={onScorePress}
              accessibilityRole="button"
            >
              <View style={styles.statCardHeader}>
                <Text style={styles.statLabelDark}>Score</Text>
                <CaretRight size={11} color="#F1EAF7" weight="bold" />
              </View>
              {scorePending && score == null ? (
                <ActivityIndicator
                  size="small"
                  color="#F1EAF7"
                  style={styles.statSpinner}
                />
              ) : (
                <Text style={styles.statValueDark}>{scoreDisplay}</Text>
              )}
            </Pressable>

            {/* Applied Card */}
            <Pressable
              style={({ pressed }) => [
                styles.statCardLight,
                pressed && styles.cardPressed,
              ]}
              onPress={onAppliedPress}
              accessibilityRole="button"
            >
              <View style={styles.statCardHeader}>
                <Text style={styles.statLabelLight}>Applied</Text>
                <CaretRight size={11} color="#6E7889" weight="bold" />
              </View>
              <Text style={styles.statValueLight}>{appliedDisplay}</Text>
            </Pressable>

            {/* Add-ons Card */}
            <Pressable
              style={({ pressed }) => [
                styles.statCardLight,
                pressed && styles.cardPressed,
              ]}
              onPress={onAddonsPress}
              accessibilityRole="button"
            >
              <View style={styles.statCardHeader}>
                <Text style={styles.statLabelLight}>Add-ons</Text>
                <CaretRight size={11} color="#6E7889" weight="bold" />
              </View>
              <Text style={styles.statValueLight}>{addonsDisplay}</Text>
            </Pressable>
          </View>

          {/* Section: MY INFORMATION */}
          <View style={styles.sectionContainer}>
            <View style={styles.sectionEyebrow}>
              <UserCircle size={12} color="#A87C17" weight="bold" />
              <Text style={styles.sectionEyebrowText}>MY INFORMATION</Text>
            </View>

            {/* Profile details */}
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.cardPressed,
              ]}
              onPress={onResumeDetailsPress}
              accessibilityRole="button"
            >
              <UserCircle size={20} color={Colors.navy} weight="duotone" />
              <Text style={styles.menuItemTitle}>Profile details</Text>
              <CaretRight size={16} color="#5F6B80" weight="bold" />
            </Pressable>

            {/* Resume review */}
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.cardPressed,
              ]}
              onPress={onResumeReviewPress}
              accessibilityRole="button"
            >
              <FileText size={20} color={Colors.navy} weight="duotone" />
              <Text style={styles.menuItemTitle}>Resume review</Text>
              <CaretRight size={16} color="#5F6B80" weight="bold" />
            </Pressable>

            {/* Subscription */}
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.cardPressed,
              ]}
              onPress={onSubscriptionPress}
              accessibilityRole="button"
            >
              <CreditCard size={20} color={Colors.navy} weight="duotone" />
              <Text style={styles.menuItemTitle}>Subscription</Text>
              {subscriptionState ? (
                <View
                  style={[
                    styles.subBadgePill,
                    hasSubscriptionAccess
                      ? styles.subBadgePillActive
                      : styles.subBadgePillDefault,
                  ]}
                >
                  <Text
                    style={[
                      styles.subBadgePillText,
                      hasSubscriptionAccess
                        ? styles.subBadgePillActiveText
                        : styles.subBadgePillDefaultText,
                    ]}
                  >
                    {subscriptionState}
                  </Text>
                </View>
              ) : null}
              <CaretRight size={16} color="#5F6B80" weight="bold" />
            </Pressable>

            {/* Attribute report (commented out as requested) */}
            {/*
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.cardPressed,
              ]}
              onPress={onAttributeReportPress}
              accessibilityRole="button"
            >
              <Compass size={20} color={Colors.navy} weight="duotone" />
              <Text style={styles.menuItemTitle}>Attribute report</Text>
              <CaretRight size={16} color="#5F6B80" weight="bold" />
            </Pressable>
            */}

            {/* Certified skill courses (adjusted in place of attribute report) */}
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.cardPressed,
              ]}
              onPress={onCoursesPress}
              accessibilityRole="button"
            >
              <GraduationCap size={20} color={Colors.navy} weight="duotone" />
              <Text style={styles.menuItemTitle}>Certified skill courses</Text>
              <CaretRight size={16} color="#5F6B80" weight="bold" />
            </Pressable>

            {/* Interview report */}
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.cardPressed,
              ]}
              onPress={onInterviewReportPress}
              accessibilityRole="button"
            >
              <MicrophoneStage size={20} color={Colors.navy} weight="duotone" />
              <Text style={styles.menuItemTitle}>Interview report</Text>
              <CaretRight size={16} color="#5F6B80" weight="bold" />
            </Pressable>

            {/* Language */}
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.cardPressed,
              ]}
              onPress={onLanguagePress}
              accessibilityRole="button"
            >
              <Translate size={20} color={Colors.navy} weight="duotone" />
              <Text style={styles.menuItemTitle}>Language</Text>
              <Text style={styles.menuItemSubText}>English</Text>
              <CaretRight size={16} color="#5F6B80" weight="bold" />
            </Pressable>
          </View>

          {/* Section: PRIVACY AND DATA */}
          <View style={styles.sectionContainer}>
            <View style={styles.sectionEyebrow}>
              <LockKey size={12} color="#A87C17" weight="bold" />
              <Text style={styles.sectionEyebrowText}>PRIVACY AND DATA</Text>
            </View>

            {/* Who has seen me */}
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.cardPressed,
              ]}
              onPress={onWhoHasSeenMePress}
              accessibilityRole="button"
            >
              <Eye size={20} color={Colors.indigo} weight="duotone" />
              <Text style={styles.menuItemTitle}>Who has seen me</Text>
              <CaretRight size={16} color="#5F6B80" weight="bold" />
            </Pressable>

            {/* Download my data */}
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.cardPressed,
              ]}
              onPress={onDownloadDataPress}
              accessibilityRole="button"
            >
              <DownloadSimple size={20} color="#3A4761" weight="duotone" />
              <View style={styles.menuItemColumn}>
                <Text style={styles.menuItemTitle}>Download my data</Text>
                <Text style={styles.menuItemDate}>
                  Asked 8 Aug · ready by 15 Aug
                </Text>
              </View>
              <View style={styles.badgePill}>
                <Text style={styles.badgePillText}>Working</Text>
              </View>
            </Pressable>

            {/* Logout my account */}
            <Pressable
              style={({ pressed }) => [
                styles.menuItem,
                pressed && styles.cardPressed,
              ]}
              onPress={handleLogout}
              accessibilityRole="button"
            >
              <SignOut size={20} color="#D9383A" weight="bold" />
              <Text style={[styles.menuItemTitle, styles.logoutText]}>Logout my account</Text>
              <CaretRight size={16} color="#5F6B80" weight="bold" />
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Floating Bottom Tab Bar */}
      {onTabPress && (
        <BottomTabBar activeTab={activeTab} onTabPress={onTabPress} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFCF7', // Matches brand offWhite canvas
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: Spacing.xl,
    paddingBottom: 154, // Space for floating bottom tab bar so logout button is never cut
    gap: 20,
  },
  header: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  avatarBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#F1EAF7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 19,
    lineHeight: 24,
    color: '#4A3E8F',
  },
  userInfo: {
    flex: 1,
    gap: 4,
  },
  userName: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 21,
    lineHeight: 24,
    letterSpacing: -0.5,
    color: Colors.navy,
  },
  userSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 16,
    color: '#5F6B80',
  },
  statsRow: {
    paddingHorizontal: 20,
    flexDirection: 'row',
    gap: 8,
  },
  statCardDark: {
    flex: 1,
    backgroundColor: '#5F4DB2',
    borderWidth: 1,
    borderColor: '#5F4DB2',
    borderRadius: 16,
    padding: 12,
    gap: 4,
    minHeight: 70,
  },
  statCardLight: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 16,
    padding: 12,
    gap: 4,
    minHeight: 70,
  },
  statCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  statLabelDark: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 11,
    lineHeight: 16,
    color: '#F1EAF7',
  },
  statValueDark: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 20,
    lineHeight: 24,
    color: '#FFFFFF',
  },
  statSpinner: {
    height: 24,
  },
  statLabelLight: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    lineHeight: 16,
    color: '#5F6B80',
  },
  statValueLight: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 20,
    lineHeight: 24,
    color: Colors.navy,
  },
  sectionContainer: {
    paddingHorizontal: 20,
    gap: 8,
  },
  sectionEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingBottom: 4,
  },
  sectionEyebrowText: {
    fontFamily: Platform.select({
      ios: 'SpaceMono-Bold',
      android: 'SpaceMono-Bold',
      default: 'monospace',
    }),
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 1.2,
    fontWeight: '700',
    color: '#5F6B80',
  },
  menuItem: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  menuItemTitle: {
    flex: 1,
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
  },
  menuItemSubText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 16,
    color: '#5F6B80',
    marginRight: 4,
  },
  menuItemColumn: {
    flex: 1,
    gap: 2,
  },
  menuItemDate: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  badgePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
  },
  badgePillText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 16,
    color: Colors.navy,
  },
  subBadgePill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    marginRight: 4,
  },
  subBadgePillActive: {
    backgroundColor: '#E6F1EA',
  },
  subBadgePillDefault: {
    backgroundColor: '#F3EFE9',
  },
  subBadgePillText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 11,
    lineHeight: 14,
    textTransform: 'uppercase',
  },
  subBadgePillActiveText: {
    color: '#23805D',
  },
  subBadgePillDefaultText: {
    color: '#5F6B80',
  },
  cardPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  logoutText: {
    color: '#D9383A',
  },
});
