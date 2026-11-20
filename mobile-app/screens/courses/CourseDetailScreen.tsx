import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  CheckCircle,
  PlayCircle,
  Lock,
  Sparkle,
  Clock,
  BookOpen,
  WarningCircle,
  Play,
  ArrowRight,
  Check,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { CourseDetail, CourseLesson } from '@/types/course';
import {
  checkoutCourse,
  coursesErrorMessage,
  formatCourseDuration,
  formatPriceINR,
  formatTimerSeconds,
  getCourseDetail,
  recordLessonProgress,
} from '@/services/api/courses';
import { PaymentSheet } from '@/screens/subscription/PaymentSheet';
import { CheckoutResponse } from '@/services/api/subscription';

const TARGET_FALLBACK_VIDEO_ID = 'lFeYU31TnQ8';

function extractYouTubeId(url: string | null | undefined): string {
  if (!url) return TARGET_FALLBACK_VIDEO_ID;
  const match = url.match(/(?:embed\/|v=|youtu\.be\/|\/v\/)([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : TARGET_FALLBACK_VIDEO_ID;
}

function buildYouTubeEmbedHtml(videoId: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; background-color: #000000; }
    html, body { width: 100%; height: 100%; overflow: hidden; background-color: #000000; display: flex; align-items: center; justify-content: center; }
    iframe { width: 100%; height: 100%; border: 0; }
  </style>
</head>
<body>
  <iframe
    src="https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0&modestbranding=1&enablejsapi=1&fs=1"
    frameborder="0"
    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
    allowfullscreen
  ></iframe>
</body>
</html>
`;
}

interface Props {
  courseId: string;
  onBack?: () => void;
}

export function CourseDetailScreen({ courseId, onBack }: Props) {
  const router = useRouter();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Video playback state
  const [activeLesson, setActiveLesson] = useState<CourseLesson | null>(null);
  const [videoLoading, setVideoLoading] = useState(true);
  const [markingComplete, setMarkingComplete] = useState(false);

  // Payment checkout state
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [purchasing, setPurchasing] = useState(false);

  const load = useCallback(async () => {
    if (!courseId) return;
    setError(null);
    try {
      const data = await getCourseDetail(courseId);
      setCourse(data);
    } catch (caught) {
      setError(coursesErrorMessage(caught, 'Could not load course details.'));
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  // Find flattened list of all lessons
  const allLessons = course?.modules.flatMap((m) => m.lessons) || [];

  // Auto-select first lesson when course is unlocked and none is active
  useEffect(() => {
    if (course && !course.locked && !activeLesson && allLessons.length > 0) {
      // Pick first incomplete lesson, or just the first lesson
      const firstIncomplete = allLessons.find((l) => !l.completed) || allLessons[0];
      setActiveLesson(firstIncomplete);
    }
  }, [course, activeLesson, allLessons]);

  const goBack = () => {
    if (onBack) onBack();
    else if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  const getNextLesson = (currentId: string): CourseLesson | null => {
    const idx = allLessons.findIndex((l) => l.id === currentId);
    if (idx >= 0 && idx < allLessons.length - 1) {
      return allLessons[idx + 1];
    }
    return null;
  };

  const handleLessonPress = (lesson: CourseLesson) => {
    if (course?.locked) {
      handleCheckout();
      return;
    }
    setActiveLesson(lesson);
    setVideoLoading(true);
  };

  const handleNextLesson = () => {
    if (!activeLesson) return;
    const next = getNextLesson(activeLesson.id);
    if (next) {
      setActiveLesson(next);
      setVideoLoading(true);
    }
  };

  const handleMarkComplete = async () => {
    if (!course || !activeLesson || markingComplete) return;
    setMarkingComplete(true);
    try {
      await recordLessonProgress(course.id, activeLesson.id, activeLesson.duration_seconds);
      // Reload course syllabus to update completion checkmarks & progress
      await load();
      const next = getNextLesson(activeLesson.id);
      if (next) {
        setActiveLesson(next);
        setVideoLoading(true);
      }
    } catch (err) {
      console.warn('[Courses] Failed to mark lesson complete:', err);
    } finally {
      setMarkingComplete(false);
    }
  };

  const handleCheckout = async () => {
    if (!course) return;
    setPurchasing(true);
    setError(null);
    try {
      const result = await checkoutCourse(course.id);
      setCheckout({
        payment_id: result.payment_id,
        status: result.status,
        amount_minor: result.amount_minor,
        list_amount_minor: result.list_amount_minor,
        currency: result.currency,
        redirect_url: result.redirect_url,
      });
    } catch (caught) {
      setError(coursesErrorMessage(caught, 'Could not start payment.'));
    } finally {
      setPurchasing(false);
    }
  };

  const handlePaymentSuccess = () => {
    setCheckout(null);
    load();
  };

  const nextLesson = activeLesson ? getNextLesson(activeLesson.id) : null;
  const activeVideoId = activeLesson
    ? extractYouTubeId(activeLesson.media_url)
    : TARGET_FALLBACK_VIDEO_ID;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={goBack}>
          <ArrowLeft size={18} color={Colors.navy} weight="bold" />
        </Pressable>
        <View style={styles.headerTextCol}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {course?.title || 'Certified Course'}
          </Text>
          <Text style={styles.headerSubtitle} numberOfLines={1}>
            {course ? `${course.lessons_total} Lessons • +${course.contribution_points || 30} Bharatpath Score` : 'BharatPath Learning'}
          </Text>
        </View>
      </View>

      {/* Pinned 16:9 Inline Video Player Platform Frame */}
      <View style={styles.playerContainer}>
        {course?.locked ? (
          <View style={styles.lockedPlayerOverlay}>
            <View style={styles.lockedBadge}>
              <Lock size={18} color="#F4D685" weight="fill" />
              <Text style={styles.lockedBadgeText}>COURSE LOCKED</Text>
            </View>
            <Text style={styles.lockedHeadline}>Unlock to Stream All Lessons</Text>
            <Text style={styles.lockedSub}>
              Includes HD video lessons, DAR frameworks, and +30 Bharatpath Score boost.
            </Text>
            <Pressable
              style={({ pressed }) => [
                styles.playerUnlockBtn,
                pressed && styles.btnPressed,
                purchasing && styles.btnDisabled,
              ]}
              onPress={handleCheckout}
              disabled={purchasing}
            >
              {purchasing ? (
                <ActivityIndicator color="#0A1931" />
              ) : (
                <Text style={styles.playerUnlockBtnText}>
                  Unlock for {formatPriceINR(course.price_minor)}
                </Text>
              )}
            </Pressable>
          </View>
        ) : activeLesson ? (
          <View style={styles.videoWrapper}>
            <WebView
              key={activeLesson.id}
              source={{
                html: buildYouTubeEmbedHtml(activeVideoId),
                baseUrl: 'https://www.youtube-nocookie.com',
              }}
              style={styles.webview}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo={true}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              originWhitelist={['*']}
              startInLoadingState={true}
              onLoadEnd={() => setVideoLoading(false)}
              renderLoading={() => (
                <View style={styles.videoLoader}>
                  <ActivityIndicator size="large" color="#F4D685" />
                  <Text style={styles.videoLoaderText}>Loading video…</Text>
                </View>
              )}
            />
          </View>
        ) : (
          <View style={styles.idlePlayer}>
            <Play size={44} color="#F4D685" weight="fill" />
            <Text style={styles.idleText}>Select a lesson to begin</Text>
          </View>
        )}
      </View>

      {/* Active Video Status & Controls Bar */}
      {activeLesson && !course?.locked && (
        <View style={styles.activeLessonBar}>
          <View style={styles.activeLessonInfo}>
            <View style={styles.nowPlayingPill}>
              <View style={styles.pulsingDot} />
              <Text style={styles.nowPlayingPillText}>NOW PLAYING</Text>
            </View>
            <Text style={styles.activeLessonTitle} numberOfLines={1}>
              {activeLesson.title}
            </Text>
          </View>

          <View style={styles.activeLessonActions}>
            {!activeLesson.completed ? (
              <Pressable
                style={({ pressed }) => [
                  styles.markCompleteBtn,
                  pressed && styles.btnPressed,
                  markingComplete && styles.btnDisabled,
                ]}
                onPress={handleMarkComplete}
                disabled={markingComplete}
              >
                {markingComplete ? (
                  <ActivityIndicator size="small" color="#5F4DB2" />
                ) : (
                  <>
                    <Check size={13} color="#5F4DB2" weight="bold" />
                    <Text style={styles.markCompleteText}>Complete</Text>
                  </>
                )}
              </Pressable>
            ) : (
              <View style={styles.completedTag}>
                <CheckCircle size={14} color="#1F7A4D" weight="fill" />
                <Text style={styles.completedTagText}>Done</Text>
              </View>
            )}

            {nextLesson && (
              <Pressable
                style={({ pressed }) => [
                  styles.nextLessonBtn,
                  pressed && styles.btnPressed,
                ]}
                onPress={handleNextLesson}
              >
                <Text style={styles.nextLessonBtnText}>Next</Text>
                <ArrowRight size={13} color="#FFFFFF" weight="bold" />
              </Pressable>
            )}
          </View>
        </View>
      )}

      {/* Scrollable Course Details & Syllabus */}
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        showsVerticalScrollIndicator={false}
      >
        {loading && !course ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color={Colors.brandAccent} />
            <Text style={styles.loadingText}>Loading course syllabus…</Text>
          </View>
        ) : error && !course ? (
          <View style={styles.errorContainer}>
            <WarningCircle size={28} color={Colors.red.fg} weight="fill" />
            <Text style={styles.errorTitle}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryBtnText}>Try Again</Text>
            </Pressable>
          </View>
        ) : course ? (
          <>
            {/* Course Summary & Progress Card */}
            <View style={styles.summaryCard}>
              <View style={styles.heroBadgeRow}>
                <View style={styles.scoreBadge}>
                  <Sparkle size={13} color="#92400E" weight="fill" />
                  <Text style={styles.scoreBadgeText}>+30 Bharatpath Score boost</Text>
                </View>
                {course.completed && (
                  <View style={styles.completedPill}>
                    <CheckCircle size={13} color={Colors.green.fg} weight="fill" />
                    <Text style={styles.completedPillText}>COMPLETED</Text>
                  </View>
                )}
              </View>

              <Text style={styles.courseTitle}>{course.title}</Text>

              {/* Course Meta Info */}
              <View style={styles.metaRow}>
                <View style={styles.metaItem}>
                  <BookOpen size={14} color="#64748B" />
                  <Text style={styles.metaText}>{course.lessons_total} Lessons</Text>
                </View>
                <View style={styles.metaDot} />
                <View style={styles.metaItem}>
                  <Clock size={14} color="#64748B" />
                  <Text style={styles.metaText}>Self-Paced Learning</Text>
                </View>
              </View>

              {/* Progress Bar */}
              <View style={styles.progressContainer}>
                <View style={styles.progressHeader}>
                  <Text style={styles.progressLabel}>
                    {course.percent_complete}% Completed
                  </Text>
                  <Text style={styles.progressCount}>
                    {course.lessons_completed} of {course.lessons_total} watched
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
            </View>

            {/* Syllabus Section */}
            <View style={styles.syllabusSection}>
              <Text style={styles.sectionHeading}>COURSE SYLLABUS</Text>

              {course.modules.map((module, mIdx) => (
                <View key={module.id} style={styles.moduleCard}>
                  <Text style={styles.moduleTitle}>
                    {module.title || `Module ${mIdx + 1}`}
                  </Text>

                  {module.lessons.map((lesson) => {
                    const isLessonLocked = course.locked;
                    const isCurrentPlaying = activeLesson?.id === lesson.id && !isLessonLocked;

                    return (
                      <Pressable
                        key={lesson.id}
                        style={({ pressed }) => [
                          styles.lessonRow,
                          isCurrentPlaying && styles.lessonRowActive,
                          pressed && styles.rowPressed,
                        ]}
                        onPress={() => handleLessonPress(lesson)}
                      >
                        <View style={styles.lessonIconContainer}>
                          {lesson.completed ? (
                            <CheckCircle size={22} color={Colors.green.fg} weight="fill" />
                          ) : isLessonLocked ? (
                            <Lock size={18} color={Colors.text.muted} weight="bold" />
                          ) : isCurrentPlaying ? (
                            <PlayCircle size={22} color="#5F4DB2" weight="fill" />
                          ) : (
                            <PlayCircle size={22} color={Colors.brandAccent} weight="regular" />
                          )}
                        </View>

                        <View style={styles.lessonContent}>
                          <View style={styles.lessonTitleRow}>
                            <Text
                              style={[
                                styles.lessonTitle,
                                isCurrentPlaying && styles.activeLessonText,
                                lesson.completed && styles.completedLessonTitle,
                              ]}
                              numberOfLines={2}
                            >
                              {lesson.title}
                            </Text>
                            {isCurrentPlaying && (
                              <View style={styles.playingBadge}>
                                <Text style={styles.playingBadgeText}>PLAYING</Text>
                              </View>
                            )}
                          </View>

                          {lesson.description && (
                            <Text style={styles.lessonDescText} numberOfLines={2}>
                              {lesson.description}
                            </Text>
                          )}

                          <View style={styles.lessonMetaRow}>
                            <Text style={styles.durationText}>
                              {formatTimerSeconds(lesson.duration_seconds)}
                            </Text>
                            {lesson.completed && (
                              <Text style={styles.completedSubText}>• Finished</Text>
                            )}
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      {/* Sticky Bottom Purchase Bar if Course is Locked */}
      {course?.locked && (
        <View style={styles.bottomBar}>
          <View style={styles.bottomPriceCol}>
            <Text style={styles.bottomPriceLabel}>One-time Certification Access</Text>
            <Text style={styles.bottomPriceValue}>
              {formatPriceINR(course.price_minor)}
            </Text>
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.unlockBtn,
              pressed && styles.btnPressed,
              purchasing && styles.btnDisabled,
            ]}
            onPress={handleCheckout}
            disabled={purchasing}
          >
            {purchasing ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.unlockBtnText}>
                Unlock Course ({formatPriceINR(course.price_minor)})
              </Text>
            )}
          </Pressable>
        </View>
      )}

      {/* Payment Sheet */}
      {checkout && course && (
        <PaymentSheet
          checkout={checkout}
          planLabel={`Course: ${course.title}`}
          onPaid={handlePaymentSuccess}
          onClose={() => setCheckout(null)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFCF7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: 10,
    backgroundColor: '#FFFCF7',
    borderBottomWidth: 1,
    borderBottomColor: '#EBE5D8',
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTextCol: {
    flex: 1,
  },
  headerTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 18,
    color: Colors.navy,
  },
  headerSubtitle: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    lineHeight: 14,
    color: '#64748B',
    marginTop: 2,
  },
  // 16:9 Embedded Video Player
  playerContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000000',
    overflow: 'hidden',
  },
  videoWrapper: {
    flex: 1,
    backgroundColor: '#000000',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
  videoLoader: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  videoLoaderText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#F4D685',
  },
  lockedPlayerOverlay: {
    flex: 1,
    backgroundColor: '#0A1931',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  lockedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(244, 214, 133, 0.16)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  lockedBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    letterSpacing: 1.2,
    color: '#F4D685',
  },
  lockedHeadline: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  lockedSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: 'rgba(255, 255, 255, 0.7)',
    textAlign: 'center',
    lineHeight: 16,
  },
  playerUnlockBtn: {
    backgroundColor: '#F4D685',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: Radii.pill,
    marginTop: 4,
  },
  playerUnlockBtnText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    color: '#0A1931',
  },
  idlePlayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  idleText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  // Active lesson control bar directly below video
  activeLessonBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#0F1E36',
    paddingHorizontal: Spacing.base,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  activeLessonInfo: {
    flex: 1,
    marginRight: 10,
  },
  nowPlayingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 2,
  },
  pulsingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  nowPlayingPillText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    letterSpacing: 1,
    color: '#F4D685',
  },
  activeLessonTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  activeLessonActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  markCompleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F4F0FF',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: Radii.pill,
  },
  markCompleteText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    color: '#5F4DB2',
  },
  completedTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(31, 122, 77, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  completedTagText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    color: '#4ADE80',
  },
  nextLessonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#5F4DB2',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
  },
  nextLessonBtnText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    color: '#FFFFFF',
  },
  // Scrollable Syllabus
  scrollContent: {
    padding: Spacing.base,
    paddingBottom: 110,
  },
  centerContainer: {
    paddingVertical: 60,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: Colors.text.muted,
  },
  errorContainer: {
    padding: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  errorTitle: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: Colors.red.fg,
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.surface.tint,
    borderRadius: Radii.pill,
  },
  retryBtnText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    color: Colors.navy,
  },
  summaryCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EAE4D7',
    marginBottom: 16,
    gap: 10,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  scoreBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    color: '#92400E',
    letterSpacing: 0.5,
  },
  completedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
  },
  completedPillText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    color: '#166534',
    letterSpacing: 0.5,
  },
  courseTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 17,
    lineHeight: 22,
    color: Colors.navy,
  },
  metaRow: {
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
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#64748B',
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
  },
  progressContainer: {
    marginTop: 4,
    gap: 6,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressLabel: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 12,
    color: Colors.navy,
  },
  progressCount: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    color: '#64748B',
  },
  progressBarTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#F1EAF7',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#5F4DB2',
    borderRadius: 3,
  },
  syllabusSection: {
    gap: 14,
  },
  sectionHeading: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    letterSpacing: 1.2,
    color: '#64748B',
  },
  moduleCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#EAE4D7',
    gap: 12,
  },
  moduleTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: Colors.navy,
  },
  lessonRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 10,
    borderRadius: 12,
    backgroundColor: '#FAFAF8',
    borderWidth: 1,
    borderColor: '#F1EBE1',
  },
  lessonRowActive: {
    backgroundColor: '#F7F4FF',
    borderColor: '#5F4DB2',
  },
  rowPressed: {
    opacity: 0.75,
  },
  lessonIconContainer: {
    marginTop: 2,
  },
  lessonContent: {
    flex: 1,
    gap: 3,
  },
  lessonTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  lessonTitle: {
    flex: 1,
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.navy,
  },
  activeLessonText: {
    color: '#5F4DB2',
  },
  completedLessonTitle: {
    color: '#64748B',
  },
  playingBadge: {
    backgroundColor: '#5F4DB2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: Radii.pill,
  },
  playingBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 9,
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  lessonDescText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#64748B',
  },
  lessonMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  durationText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    color: '#94A3B8',
  },
  completedSubText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    color: '#1F7A4D',
  },
  // Bottom Purchase Sticky Bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: Spacing.base,
    paddingTop: 12,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: '#EBE5D8',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 8,
  },
  bottomPriceCol: {
    flex: 1,
  },
  bottomPriceLabel: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    color: '#64748B',
  },
  bottomPriceValue: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 19,
    color: Colors.navy,
  },
  unlockBtn: {
    backgroundColor: '#5F4DB2',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: Radii.pill,
  },
  unlockBtnText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    color: '#FFFFFF',
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
