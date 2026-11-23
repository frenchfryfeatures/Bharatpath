import React, { useEffect, useRef, useState, useCallback } from 'react';
import { AppModal as Modal } from '@/components/layout/AppModal';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import {
  X,
  CheckCircle,
  Sparkle,
  ArrowRight,
  Play,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { CourseLesson, LessonProgressResult } from '@/types/course';
import {
  formatTimerSeconds,
  recordLessonProgress,
} from '@/services/api/courses';

interface Props {
  visible: boolean;
  courseId: string;
  lesson: CourseLesson | null;
  nextLesson?: CourseLesson | null;
  onClose: () => void;
  onLessonCompleted?: (result: LessonProgressResult) => void;
  onPlayNextLesson?: () => void;
}

export function LessonPlayerModal({
  visible,
  courseId,
  lesson,
  nextLesson,
  onClose,
  onLessonCompleted,
  onPlayNextLesson,
}: Props) {
  const [positionSeconds, setPositionSeconds] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [courseCompleted, setCourseCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const currentPosRef = useRef(0);

  // Initialize position and completion status when lesson opens
  useEffect(() => {
    if (lesson) {
      setPositionSeconds(lesson.position_seconds || 0);
      currentPosRef.current = lesson.position_seconds || 0;
      setIsCompleted(lesson.completed);
      setCourseCompleted(false);
      setLoading(true);
    }
  }, [lesson]);

  // Report progress helper
  const syncProgress = useCallback(
    async (seconds: number) => {
      if (!lesson || !courseId) return;
      try {
        const result = await recordLessonProgress(courseId, lesson.id, seconds);
        if (result.completed && !isCompleted) {
          setIsCompleted(true);
        }
        if (result.course_completed && !courseCompleted) {
          setCourseCompleted(true);
        }
        onLessonCompleted?.(result);
      } catch (err) {
        // Silently ignore background ping errors so video keeps playing
        console.warn('[Courses] Failed to sync progress:', err);
      }
    },
    [courseId, lesson, isCompleted, courseCompleted, onLessonCompleted]
  );

  // Simulate local progress counter & send heartbeat every 30 seconds
  useEffect(() => {
    if (!visible || !lesson || !lesson.media_url) return;

    // Local tick every second
    const tickInterval = setInterval(() => {
      currentPosRef.current += 1;
      setPositionSeconds(currentPosRef.current);
    }, 1000);

    // Sync to backend every 30 seconds (and once more on close)
    progressTimerRef.current = setInterval(() => {
      syncProgress(currentPosRef.current);
    }, 30000);

    return () => {
      clearInterval(tickInterval);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      // Final sync on unmount/close
      if (currentPosRef.current > 0) {
        syncProgress(currentPosRef.current);
      }
    };
  }, [visible, lesson, syncProgress]);

  if (!lesson) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen">
      <SafeAreaView style={styles.safeContainer} edges={['top']}>
        {/* Top Header */}
        <View style={styles.header}>
          <View style={styles.headerTextGroup}>
            <Text style={styles.eyebrow}>NOW PLAYING</Text>
            <Text style={styles.headerTitle} numberOfLines={1}>
              {lesson.title}
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [styles.closeBtn, pressed && styles.btnPressed]}
            onPress={() => {
              syncProgress(currentPosRef.current);
              onClose();
            }}
            accessibilityRole="button"
            accessibilityLabel="Close video player"
          >
            <X size={20} color={Colors.navy} weight="bold" />
          </Pressable>
        </View>

        {/* Video Player Area */}
        <View style={styles.playerContainer}>
          {lesson.media_url ? (
            <WebView
              source={{ uri: lesson.media_url }}
              style={styles.webview}
              allowsFullscreenVideo
              javaScriptEnabled
              domStorageEnabled
              startInLoadingState
              onLoadEnd={() => setLoading(false)}
              renderLoading={() => (
                <View style={styles.loaderContainer}>
                  <ActivityIndicator size="large" color={Colors.brandAccent} />
                </View>
              )}
            />
          ) : (
            <View style={styles.lockedPlaceholder}>
              <Play size={36} color={Colors.text.muted} weight="fill" />
              <Text style={styles.lockedText}>This video is locked</Text>
            </View>
          )}
        </View>

        {/* Progress & Lesson Details */}
        <View style={styles.detailsContainer}>
          {/* Progress / Status Badge */}
          <View style={styles.statusRow}>
            {isCompleted ? (
              <View style={styles.completedBadge}>
                <CheckCircle size={15} color={Colors.green.fg} weight="fill" />
                <Text style={styles.completedBadgeText}>Lesson Watched</Text>
              </View>
            ) : (
              <View style={styles.inProgressBadge}>
                <Text style={styles.inProgressBadgeText}>
                  Watching • {formatTimerSeconds(positionSeconds)} /{' '}
                  {formatTimerSeconds(lesson.duration_seconds)}
                </Text>
              </View>
            )}

            {courseCompleted && (
              <View style={styles.courseBoostBadge}>
                <Sparkle size={14} color="#92400E" weight="fill" />
                <Text style={styles.courseBoostBadgeText}>+30 PTS AWARDED</Text>
              </View>
            )}
          </View>

          {/* Description */}
          {lesson.description && (
            <Text style={styles.description}>{lesson.description}</Text>
          )}

          {/* Course Completed Celebration Banner */}
          {courseCompleted && (
            <View style={styles.celebrationCard}>
              <View style={styles.celebrationHeader}>
                <Sparkle size={20} color="#B9891A" weight="fill" />
                <Text style={styles.celebrationTitle}>Course Completed!</Text>
              </View>
              <Text style={styles.celebrationBody}>
                You have watched every lesson in this course. 30 points have been
                added to your Bharatpath Score!
              </Text>
            </View>
          )}

          {/* Next Lesson CTA */}
          {nextLesson && (
            <Pressable
              style={({ pressed }) => [
                styles.nextLessonBtn,
                pressed && styles.btnPressed,
              ]}
              onPress={() => {
                syncProgress(currentPosRef.current);
                onPlayNextLesson?.();
              }}
            >
              <View style={styles.nextLessonInfo}>
                <Text style={styles.nextLessonEyebrow}>UP NEXT</Text>
                <Text style={styles.nextLessonTitle} numberOfLines={1}>
                  {nextLesson.title}
                </Text>
              </View>
              <ArrowRight size={18} color="#FFFFFF" weight="bold" />
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: Colors.offWhite,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  headerTextGroup: {
    flex: 1,
    marginRight: Spacing.md,
  },
  eyebrow: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: Colors.brandAccent,
  },
  headerTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: Colors.navy,
    marginTop: 2,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  playerContainer: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000000',
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000000',
  },
  loaderContainer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockedPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#1E293B',
    gap: 8,
  },
  lockedText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: '#94A3B8',
  },
  detailsContainer: {
    flex: 1,
    padding: Spacing.lg,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: Spacing.md,
  },
  completedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.green.bg,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
  },
  completedBadgeText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    color: Colors.green.fg,
  },
  inProgressBadge: {
    backgroundColor: Colors.surface.tint,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  inProgressBadgeText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: Colors.text.muted,
  },
  courseBoostBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
  },
  courseBoostBadgeText: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 11,
    color: '#92400E',
  },
  description: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.text.primary,
    marginBottom: Spacing.lg,
  },
  celebrationCard: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#F59E0B',
    borderRadius: Radii.card,
    padding: Spacing.base,
    marginBottom: Spacing.lg,
  },
  celebrationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  celebrationTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: '#92400E',
  },
  celebrationBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#78350F',
  },
  nextLessonBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.brandAccent,
    borderRadius: Radii.card,
    padding: Spacing.md,
    marginTop: 'auto',
  },
  nextLessonInfo: {
    flex: 1,
    marginRight: Spacing.md,
  },
  nextLessonEyebrow: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.7)',
    letterSpacing: 0.5,
  },
  nextLessonTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: '#FFFFFF',
    marginTop: 2,
  },
});
