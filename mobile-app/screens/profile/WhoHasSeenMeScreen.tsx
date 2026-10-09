/**
 * BharatPath - WhoHasSeenMeScreen
 * Matches Screen 41 from BharatPath Handoff and Screenshot 2.
 * Integrated with Backend GET /candidate/profile/views.
 *
 * Features:
 * - Circular back button & TopBar
 * - Title "Every unlock, logged" + subtitle
 * - Live employer activity logs fetched from /candidate/profile/views
 * - Initials badge with deterministic brand palette
 * - Empty state when no employers have unlocked/viewed yet
 * - Pull-to-refresh & pagination
 * - "Let employers find me" interactive toggle switch
 * - Privacy protection banner
 */
import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Animated,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, LockOpen, Info, WarningCircle, ShieldCheck } from 'phosphor-react-native';
import { Colors, Spacing } from '@/theme/tokens';
import { useProfileViews } from '@/hooks/useProfileViews';
import { getInitials, pickFromString } from '@/utils/helpers';
import { DataRightsSection } from './DataRightsSection';

export interface WhoHasSeenMeScreenProps {
  onBack?: () => void;
  defaultLetEmployersFindMe?: boolean;
}

const COLOR_PAIRS = [
  { bg: '#F1EAF7', fg: '#4A3E8F' },
  { bg: '#F7EFD6', fg: '#7A5C0E' },
  { bg: '#E6F1EA', fg: '#1F6B45' },
  { bg: '#E7E0D4', fg: '#5F6B80' },
  { bg: '#F8E6E0', fg: '#993A22' },
];

function formatActivityDate(iso: string | null | undefined): string {
  if (!iso) return 'Recently';
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return 'Recently';
  const now = new Date();

  const isToday =
    then.getDate() === now.getDate() &&
    then.getMonth() === now.getMonth() &&
    then.getFullYear() === now.getFullYear();
  if (isToday) return 'Today';

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday =
    then.getDate() === yesterday.getDate() &&
    then.getMonth() === yesterday.getMonth() &&
    then.getFullYear() === yesterday.getFullYear();
  if (isYesterday) return 'Yesterday';

  const day = then.getDate();
  const monthNames = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ];
  const month = monthNames[then.getMonth()];
  if (then.getFullYear() === now.getFullYear()) {
    return `${day} ${month}`;
  }
  return `${day} ${month} ${then.getFullYear()}`;
}

export function WhoHasSeenMeScreen({
  onBack,
  defaultLetEmployersFindMe = true,
}: WhoHasSeenMeScreenProps) {
  const {
    views,
    loading,
    loadingMore,
    refreshing,
    hasReachedEnd,
    error,
    loadMore,
    reload,
  } = useProfileViews();

  const [letEmployersFindMe, setLetEmployersFindMe] = useState(
    defaultLetEmployersFindMe
  );

  // Smooth switch animation
  const switchAnim = useRef(
    new Animated.Value(defaultLetEmployersFindMe ? 1 : 0)
  ).current;

  const toggleSwitch = () => {
    const nextVal = !letEmployersFindMe;
    setLetEmployersFindMe(nextVal);
    Animated.spring(switchAnim, {
      toValue: nextVal ? 1 : 0,
      useNativeDriver: false,
      bounciness: 4,
    }).start();
  };

  const switchTranslateX = switchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [2, 22],
  });

  const switchBgColor = switchAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#DDD6C7', '#5F4DB2'],
  });

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={reload}
              tintColor={Colors.brandAccent}
              colors={[Colors.brandAccent]}
            />
          }
        >
          {/* Top Bar with back button */}
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
            <Text style={styles.topBarTitle}>Who has seen me</Text>
          </View>

          {/* Heading Section */}
          <View style={styles.headingSection}>
            <Text style={styles.mainTitle}>Every unlock, logged</Text>
            <Text style={styles.mainSubtitle}>
              Details shows only when an employer spends an unlock.
            </Text>
          </View>

          {/* Employer Activity List */}
          <View style={styles.listContainer}>
            {/* Loading Skeleton */}
            {loading && views.length === 0 && (
              <>
                {[0, 1, 2].map((i) => (
                  <View key={i} style={[styles.employerCard, { opacity: 0.6 }]}>
                    <View style={[styles.companyBadge, { backgroundColor: '#EDE8E1' }]} />
                    <View style={styles.employerInfo}>
                      <View style={styles.skeletonTitle} />
                      <View style={styles.skeletonSubtitle} />
                    </View>
                  </View>
                ))}
              </>
            )}

            {/* Error State */}
            {error && (
              <View style={styles.errorCard}>
                <WarningCircle size={20} color={Colors.red.fg} weight="fill" />
                <Text style={styles.errorText}>{error}</Text>
                <Pressable style={styles.retryButton} onPress={reload}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </Pressable>
              </View>
            )}

            {/* Empty State */}
            {!loading && !error && views.length === 0 && (
              <View style={styles.emptyCard}>
                <View style={styles.emptyIconCircle}>
                  <LockOpen size={24} color={Colors.brandAccent} weight="duotone" />
                </View>
                <Text style={styles.emptyTitle}>No employer views yet</Text>
                <Text style={styles.emptySub}>
                  When an employer views your profile, their activity will be logged here.
                </Text>
              </View>
            )}

            {/* Live Views List */}
            {views.map((item, idx) => {
              const initials = getInitials(item.employer_name);
              const dateLabel = formatActivityDate(item.last_viewed_at);
              const colorPair = pickFromString(item.employer_name, COLOR_PAIRS);

              return (
                <View
                  key={`${item.employer_name}-${item.last_viewed_at}-${idx}`}
                  style={styles.employerCard}
                >
                  <View style={[styles.companyBadge, { backgroundColor: colorPair.bg }]}>
                    <Text style={[styles.companyBadgeText, { color: colorPair.fg }]}>
                      {initials}
                    </Text>
                  </View>
                  <View style={styles.employerInfo}>
                    <Text style={styles.companyName} numberOfLines={1}>
                      {item.employer_name}
                    </Text>
                    <Text style={styles.activityTime}>
                      {`${dateLabel} · unlocked your contact`}
                    </Text>
                  </View>
                  <LockOpen size={18} color={Colors.indigo} weight="fill" />
                </View>
              );
            })}

            {/* Load More Button */}
            {!hasReachedEnd && views.length > 0 && (
              <Pressable
                style={({ pressed }) => [
                  styles.loadMoreButton,
                  pressed && { opacity: 0.8 },
                ]}
                onPress={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <ActivityIndicator size="small" color={Colors.brandAccent} />
                ) : (
                  <Text style={styles.loadMoreText}>Load older activity</Text>
                )}
              </Pressable>
            )}
          </View>

          {/* Toggle Card: Let employers find me */}
          <View style={styles.toggleCard}>
            <View style={styles.toggleInfo}>
              <Text style={styles.toggleTitle}>Let employers find me</Text>
              <Text style={styles.toggleSub}>
                Turn off and you only appear where you apply
              </Text>
            </View>
            <Pressable
              onPress={toggleSwitch}
              accessibilityRole="switch"
              accessibilityState={{ checked: letEmployersFindMe }}
              accessibilityLabel="Let employers find me"
            >
              <Animated.View
                style={[
                  styles.switchTrack,
                  { backgroundColor: switchBgColor },
                ]}
              >
                <Animated.View
                  style={[
                    styles.switchThumb,
                    { transform: [{ translateX: switchTranslateX }] },
                  ]}
                />
              </Animated.View>
            </Pressable>
          </View>

          {/* Bottom Privacy Disclaimer Card */}
          <View style={styles.privacyBanner}>
            <Info size={18} color="#3A4761" weight="bold" />
            <Text style={styles.privacyBannerText}>
              Your resume file is never shared. Employers see the parsed profile only.
            </Text>
          </View>

          {/* Your privacy is protected Card */}
          <View style={styles.protectedCard}>
            <View style={styles.protectedHeader}>
              <ShieldCheck size={18} color="#1F6B45" weight="fill" />
              <Text style={styles.protectedTitle}>Your privacy is protected</Text>
            </View>
            <Text style={styles.protectedSub}>
              We show the employer organisation, never the individual recruiter or how many times they opened your profile.
            </Text>
          </View>

          {/* Your Data Section (Request export & Account deletion) */}
          <DataRightsSection />
        </ScrollView>
      </SafeAreaView>
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
    paddingHorizontal: 20,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    gap: 16,
    flexGrow: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 4,
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
  headingSection: {
    gap: 2,
  },
  mainTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.5,
    color: Colors.navy,
  },
  mainSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#3A4761',
  },
  listContainer: {
    gap: 8,
  },
  employerCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  companyBadge: {
    width: 40,
    height: 40,
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
  },
  companyBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    lineHeight: 16,
  },
  employerInfo: {
    flex: 1,
    gap: 2,
  },
  companyName: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
  },
  activityTime: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  skeletonTitle: {
    width: 140,
    height: 14,
    borderRadius: 6,
    backgroundColor: '#EDE8E1',
    marginBottom: 6,
  },
  skeletonSubtitle: {
    width: 90,
    height: 11,
    borderRadius: 5,
    backgroundColor: '#F3EFE9',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    gap: 8,
  },
  emptyIconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#F1EAF7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 22,
    color: Colors.navy,
    textAlign: 'center',
  },
  emptySub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
    textAlign: 'center',
    maxWidth: 280,
  },
  errorCard: {
    backgroundColor: Colors.red.bg,
    borderWidth: 1,
    borderColor: '#F0C4B8',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  errorText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.red.fg,
  },
  retryButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
  },
  retryButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    color: Colors.navy,
  },
  loadMoreButton: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  loadMoreText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: Colors.brandAccent,
  },
  toggleCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleInfo: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
  },
  toggleSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  switchTrack: {
    width: 48,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 1.5,
    elevation: 2,
  },
  privacyBanner: {
    marginTop: 'auto',
    backgroundColor: '#F7EFD6',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  privacyBannerText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#3A4761',
  },
  protectedCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E7E0D4',
    padding: 16,
    gap: 6,
  },
  protectedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  protectedTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: Colors.navy,
  },
  protectedSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 18,
    color: '#5F6B80',
  },
  buttonPressed: {
    transform: [{ scale: 0.96 }],
    opacity: 0.9,
  },
});
