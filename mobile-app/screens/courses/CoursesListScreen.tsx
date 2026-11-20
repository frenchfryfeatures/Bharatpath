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
  BookOpen,
  CheckCircle,
  Clock,
  Crown,
  Lock,
  Sparkle,
  ArrowRight,
  GraduationCap,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { CourseSummary } from '@/types/course';
import {
  formatPriceINR,
  isSubscriptionRequiredError,
  listCourses,
} from '@/services/api/courses';

interface Props {
  onBack?: () => void;
}

export function CoursesListScreen({ onBack }: Props) {
  const router = useRouter();
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [subscriptionRequired, setSubscriptionRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setSubscriptionRequired(false);
    try {
      const data = await listCourses();
      setCourses(data);
    } catch (caught) {
      if (isSubscriptionRequiredError(caught)) {
        setSubscriptionRequired(true);
      } else {
        setError('Could not load courses at this time.');
      }
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
    else router.replace('/home');
  };

  const handleCoursePress = (courseId: string) => {
    router.push({
      pathname: '/course-detail',
      params: { courseId },
    });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={goBack}>
          <ArrowLeft size={18} color={Colors.navy} weight="bold" />
        </Pressable>
        <View style={styles.headerTextGroup}>
          <Text style={styles.headerTitle}>Skill Courses</Text>
          <Text style={styles.headerSubtitle}>
            Boost your Bharatpath Score with certified courses
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        {/* Value Proposition Hero Banner */}
        <View style={styles.promoBanner}>
          <View style={styles.promoBadge}>
            <Sparkle size={13} color="#92400E" weight="fill" />
            <Text style={styles.promoBadgeText}>Bharatpath Score advantage</Text>
          </View>
          <Text style={styles.promoTitle}>Earn up to +30 points</Text>
          <Text style={styles.promoBody}>
            Complete certified video courses to strengthen your CV, unlock top
            matching jobs, and increase your Bharatpath Score.
          </Text>
        </View>

        {/* Loading state */}
        {loading && courses.length === 0 && (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={Colors.brandAccent} />
            <Text style={styles.loadingText}>Loading catalogue…</Text>
          </View>
        )}

        {/* 402 Subscription Required Paywall */}
        {subscriptionRequired && (
          <View style={styles.subscriptionCard}>
            <View style={styles.subscriptionIconContainer}>
              <Crown size={28} color="#B9891A" weight="fill" />
            </View>
            <Text style={styles.subscriptionTitle}>
              Membership Access Required
            </Text>
            <Text style={styles.subscriptionBody}>
              Skill courses and certified add-ons are available exclusively to
              active BharatPath members.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.subscribeBtn,
                pressed && styles.btnPressed,
              ]}
              onPress={() => router.push('/you')}
            >
              <Text style={styles.subscribeBtnText}>View Membership Plans</Text>
              <ArrowRight size={14} color="#FFFFFF" weight="bold" />
            </Pressable>
          </View>
        )}

        {/* Error state */}
        {error && !subscriptionRequired && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryBtnText}>Try Again</Text>
            </Pressable>
          </View>
        )}

        {/* Empty catalogue */}
        {!loading && !subscriptionRequired && !error && courses.length === 0 && (
          <View style={styles.emptyCard}>
            <GraduationCap size={36} color={Colors.text.muted} weight="duotone" />
            <Text style={styles.emptyTitle}>New Courses Coming Soon</Text>
            <Text style={styles.emptyBody}>
              Our career experts are preparing certified skill modules. Check back
              soon!
            </Text>
          </View>
        )}

        {/* Course Cards */}
        {courses.map((course) => {
          const isEnrolled = course.purchased;
          const isDone = course.completed;
          const inProgress = isEnrolled && !isDone && course.percent_complete > 0;

          return (
            <Pressable
              key={course.id}
              style={({ pressed }) => [
                styles.courseCard,
                pressed && styles.cardPressed,
              ]}
              onPress={() => handleCoursePress(course.id)}
            >
              <View style={styles.cardHeader}>
                <View style={styles.scorePill}>
                  <Sparkle size={12} color="#92400E" weight="fill" />
                  <Text style={styles.scorePillText}>+30 PTS</Text>
                </View>

                {isDone ? (
                  <View style={styles.completedPill}>
                    <CheckCircle size={12} color={Colors.green.fg} weight="fill" />
                    <Text style={styles.completedPillText}>COMPLETED</Text>
                  </View>
                ) : isEnrolled ? (
                  <View style={styles.enrolledPill}>
                    <Text style={styles.enrolledPillText}>ENROLLED</Text>
                  </View>
                ) : (
                  <View style={styles.pricePill}>
                    <Text style={styles.pricePillText}>
                      {formatPriceINR(course.price_minor)}
                    </Text>
                  </View>
                )}
              </View>

              <Text style={styles.cardTitle}>{course.title}</Text>

              {/* Meta row */}
              <View style={styles.cardMetaRow}>
                <View style={styles.metaItem}>
                  <BookOpen size={14} color={Colors.text.muted} />
                  <Text style={styles.metaText}>{course.lessons_total} Lessons</Text>
                </View>
                <View style={styles.metaDot} />
                <View style={styles.metaItem}>
                  <Clock size={14} color={Colors.text.muted} />
                  <Text style={styles.metaText}>Self-Paced Video</Text>
                </View>
              </View>

              {/* Progress bar if enrolled */}
              {isEnrolled && (
                <View style={styles.progressContainer}>
                  <View style={styles.progressHeader}>
                    <Text style={styles.progressLabel}>
                      {course.percent_complete}% Done
                    </Text>
                    <Text style={styles.progressSub}>
                      {course.lessons_completed} of {course.lessons_total} completed
                    </Text>
                  </View>
                  <View style={styles.progressBarTrack}>
                    <View
                      style={[
                        styles.progressBarFill,
                        { width: `${course.percent_complete}%` },
                      ]}
                    />
                  </View>
                </View>
              )}

              {/* Footer CTA Button */}
              <View style={styles.cardFooter}>
                <Text style={styles.ctaText}>
                  {isDone
                    ? 'Review Course'
                    : isEnrolled
                      ? 'Continue Learning'
                      : 'View Syllabus'}
                </Text>
                {course.locked ? (
                  <Lock size={14} color={Colors.brandAccent} weight="bold" />
                ) : (
                  <ArrowRight size={14} color={Colors.brandAccent} weight="bold" />
                )}
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.offWhite,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface.tint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  headerTextGroup: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 18,
    color: Colors.navy,
  },
  headerSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: Colors.text.muted,
    marginTop: 2,
  },
  content: {
    padding: Spacing.base,
    paddingBottom: 40,
    gap: Spacing.base,
  },
  promoBanner: {
    backgroundColor: '#FAF5FF',
    borderRadius: Radii.card,
    borderWidth: 1,
    borderColor: '#E9D5FF',
    padding: Spacing.base,
  },
  promoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    marginBottom: Spacing.xs,
  },
  promoBadgeText: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 10,
    color: '#92400E',
  },
  promoTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 17,
    color: Colors.navy,
    marginBottom: 4,
  },
  promoBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.text.primary,
  },
  centerContainer: {
    paddingVertical: 50,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: Colors.text.muted,
  },
  subscriptionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radii.card,
    borderWidth: 1,
    borderColor: '#FDE68A',
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.sm,
  },
  subscriptionIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  subscriptionTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: Colors.navy,
    textAlign: 'center',
  },
  subscriptionBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.text.muted,
    textAlign: 'center',
  },
  subscribeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.brandAccent,
    borderRadius: Radii.card,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 8,
  },
  subscribeBtnText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  errorCard: {
    backgroundColor: Colors.red.bg,
    borderRadius: Radii.card,
    padding: Spacing.lg,
    alignItems: 'center',
    gap: 8,
  },
  errorText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: Colors.red.fg,
  },
  retryBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Colors.navy,
    borderRadius: Radii.card,
  },
  retryBtnText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    color: '#FFFFFF',
  },
  emptyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radii.card,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  emptyTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: Colors.navy,
    marginTop: 6,
  },
  emptyBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    color: Colors.text.muted,
    textAlign: 'center',
  },
  courseCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radii.card,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    padding: Spacing.base,
    gap: Spacing.sm,
  },
  cardPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scorePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  scorePillText: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 10,
    color: '#92400E',
  },
  completedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.green.bg,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  completedPillText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    color: Colors.green.fg,
  },
  enrolledPill: {
    backgroundColor: Colors.surface.tint,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  enrolledPillText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    color: Colors.navy,
  },
  pricePill: {
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  pricePillText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    color: '#1D4ED8',
  },
  cardTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 17,
    color: Colors.navy,
    lineHeight: 22,
  },
  cardMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    color: Colors.text.muted,
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.surface.border,
  },
  progressContainer: {
    marginTop: 4,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  progressLabel: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 11,
    color: Colors.brandAccent,
  },
  progressSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    color: Colors.text.muted,
  },
  progressBarTrack: {
    height: 5,
    borderRadius: 2.5,
    backgroundColor: Colors.surface.tint,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: Colors.brandAccent,
    borderRadius: 2.5,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.hairline,
    marginTop: 4,
  },
  ctaText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    color: Colors.brandAccent,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
});
