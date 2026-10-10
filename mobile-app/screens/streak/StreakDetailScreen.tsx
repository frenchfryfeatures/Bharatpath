/**
 * BharatPath - StreakDetailScreen
 *
 * Full streak view: a hero with the current streak and engagement-points
 * balance, weekly activity heatmap, milestone ladder, and points history.
 *
 * Engagement points are a SEPARATE balance from the 700–990 candidate score
 * and must never be rendered beside it (`docs/streaks.md` §2). This screen
 * uses "points", never "score".
 *
 * All colours match the BharatPath design system:
 * - OffWhite canvas: #FFFCF7
 * - Card surfaces: #FFFFFF
 * - Card borders: #E7E0D4
 * - Dividers: #F0EBDF
 * - Navy headlines: #0A1931
 * - Muted text: #5F6B80
 * - Brand Purple: #5F4DB2
 * - Brand Gold: #B9891A
 * - Fire Orange: #FF6B00
 */
import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  Flame,
  Trophy,
  Medal,
  Lightning,
  Check,
  CheckCircle,
} from 'phosphor-react-native';
import { Colors, Spacing, Radii, Typography } from '@/theme/tokens';
import { useStreak } from '@/hooks/useStreak';
import {
  getStreakPointHistory,
  getStreakCalendar,
  streakStatusLabel,
  streakSubtitle,
  pointsChangeLabel,
  checkIn,
} from '@/services/api/streak';
import {
  StreakPointsChange,
  StreakMilestone,
  StreakStatus,
  StreakCalendarResponse,
  StreakViewPeriod,
} from '@/types/streak';

export interface StreakDetailScreenProps {
  onBack?: () => void;
}

/** Visual styling for the flame emblem based on status */
function getHeroFlameConfig(status: StreakStatus | undefined) {
  if (status === 'ACTIVE_TODAY') {
    return {
      color: '#FF6B00',
      bg: '#FFF3E8',
      border: '#FFE0C2',
    };
  }
  if (status === 'AT_RISK') {
    return {
      color: '#D97706',
      bg: '#FEF3C7',
      border: '#FDE68A',
    };
  }
  return {
    color: '#94A3B8',
    bg: '#F1F5F9',
    border: '#E2E8F0',
  };
}

/** Visual styling for the status pill */
function getStatusTheme(status: StreakStatus | undefined) {
  if (status === 'ACTIVE_TODAY') {
    return {
      bg: Colors.green.bg,
      text: Colors.green.fg,
      dot: Colors.green.fg,
      border: 'rgba(31, 107, 69, 0.2)',
    };
  }
  if (status === 'AT_RISK') {
    return {
      bg: Colors.amber.bg,
      text: Colors.amber.fg,
      dot: Colors.amber.fg,
      border: 'rgba(122, 92, 14, 0.2)',
    };
  }
  if (status === 'BROKEN') {
    return {
      bg: Colors.red.bg,
      text: Colors.red.fg,
      dot: Colors.red.fg,
      border: 'rgba(153, 58, 34, 0.2)',
    };
  }
  return {
    bg: Colors.surface.tint,
    text: Colors.text.muted,
    dot: Colors.text.muted,
    border: Colors.surface.border,
  };
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

function parseDateKey(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toDateKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_IN_MS);
}

function calendarArgsFor(
  period: StreakViewPeriod,
  today: string,
): {
  period?: StreakViewPeriod;
  date?: string;
  from?: string;
  to?: string;
} {
  if (period === 'year') {
    const year = today.slice(0, 4);
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  return { period, date: today };
}

interface WeekActivityDay {
  dayLabel: string;
  dayNum: number;
  dateStr: string;
  isToday: boolean;
  isActive: boolean;
  isFuture: boolean;
}

export function StreakDetailScreen({ onBack }: StreakDetailScreenProps) {
  const { streak, loading, refreshing, error, refresh } = useStreak();
  const [history, setHistory] = useState<StreakPointsChange[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [checkingIn, setCheckingIn] = useState(false);
  const [view, setView] = useState<StreakViewPeriod>('week');
  const [calendarCache, setCalendarCache] = useState<
    Record<StreakViewPeriod, StreakCalendarResponse | null>
  >({
    week: null,
    month: null,
    year: null,
  });
  const [calendarLoading, setCalendarLoading] = useState(false);
  const yearScrollRef = useRef<ScrollView>(null);

  const loadCalendar = useCallback(
    async (period: StreakViewPeriod, todayStr?: string) => {
      if (!todayStr) return;
      setCalendarLoading(true);
      try {
        const args = calendarArgsFor(period, todayStr);
        const data = await getStreakCalendar(args);
        setCalendarCache((prev) => ({ ...prev, [period]: data }));
      } catch {
        // Silent - streak data provides fallback
      } finally {
        setCalendarLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (streak?.today) {
      loadCalendar(view, streak.today);
    }
  }, [view, streak?.today, loadCalendar]);

  const loadHistory = useCallback(async () => {
    try {
      const items = await getStreakPointHistory(100);
      setHistory(items);
    } catch {
      // Silent - the streak card is the primary content.
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  const onRefresh = useCallback(() => {
    refresh();
    loadHistory();
    if (streak?.today) {
      loadCalendar(view, streak.today);
    }
  }, [refresh, loadHistory, streak?.today, view, loadCalendar]);

  const handleManualCheckIn = useCallback(async () => {
    if (checkingIn) return;
    setCheckingIn(true);
    try {
      await checkIn();
      refresh();
      loadHistory();
      if (streak?.today) {
        loadCalendar(view, streak.today);
      }
    } catch {
      // Non-fatal transient error
    } finally {
      setCheckingIn(false);
    }
  }, [checkingIn, refresh, loadHistory, streak?.today, view, loadCalendar]);

  const status = streak?.status;
  const current = streak?.current_streak ?? 0;
  const points = streak?.points_balance ?? 0;
  const longest = streak?.longest_streak ?? 0;
  const next = streak?.next_milestone;
  const milestones = streak?.milestones ?? [];
  const breakPenalty = streak?.break_penalty ?? 0;

  const flameConfig = getHeroFlameConfig(status);
  const statusTheme = getStatusTheme(status);

  const currentCalendar = calendarCache[view];

  const activeDates = useMemo(() => {
    const days = currentCalendar?.days;
    if (days && days.length > 0) {
      return new Set(
        days
          .filter((d) => d.status === 'ACTIVE')
          .map((d) => d.date),
      );
    }
    const set = new Set<string>();
    if (streak && streak.current_streak > 0 && streak.last_active_on) {
      const lastActive = parseDateKey(streak.last_active_on);
      for (let i = 0; i < streak.current_streak; i++) {
        set.add(toDateKey(addDays(lastActive, -i)));
      }
    }
    for (const h of history) {
      if (h.activity_on) set.add(h.activity_on);
    }
    return set;
  }, [currentCalendar, streak, history]);

  const weekDays = useMemo(() => {
    const todayIso = streak?.today || toDateKey(new Date());
    const date = parseDateKey(todayIso);
    const weekday = date.getUTCDay();
    const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
    const monday = addDays(date, mondayOffset);

    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(monday, i);
      const dateStr = toDateKey(d);
      const isToday = dateStr === todayIso;
      const isFuture = dateStr > todayIso;
      const isActive = activeDates.has(dateStr);

      return {
        dayLabel: WEEKDAY_LABELS[i],
        dayNum: d.getUTCDate(),
        dateStr,
        isToday,
        isActive,
        isFuture,
      };
    });
  }, [streak?.today, activeDates]);

  const monthData = useMemo(() => {
    const todayIso = streak?.today || toDateKey(new Date());
    const date = parseDateKey(todayIso);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();

    const firstDay = new Date(Date.UTC(year, month, 1));
    const lastDay = new Date(Date.UTC(year, month + 1, 0));
    const firstWeekday = firstDay.getUTCDay();
    const mondayOffset = firstWeekday === 0 ? -6 : 1 - firstWeekday;
    const firstMonday = addDays(firstDay, mondayOffset);

    const dayCount = Math.round((lastDay.getTime() - firstMonday.getTime()) / DAY_IN_MS) + 1;
    const totalGridDays = Math.ceil(dayCount / 7) * 7;
    const days = Array.from({ length: totalGridDays }, (_, i) => addDays(firstMonday, i));

    const monthName = new Intl.DateTimeFormat('en-IN', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(date);

    const completedCount = days.filter(
      (d) => d.getUTCMonth() === month && activeDates.has(toDateKey(d)),
    ).length;

    return {
      year,
      month,
      monthName,
      days,
      completedCount,
      todayIso,
    };
  }, [streak?.today, activeDates]);

  const yearData = useMemo(() => {
    const todayIso = streak?.today || toDateKey(new Date());
    const date = parseDateKey(todayIso);
    const year = date.getUTCFullYear();
    const start = new Date(Date.UTC(year, 0, 1));
    const end = new Date(Date.UTC(year, 11, 31));

    const firstWeekday = start.getUTCDay();
    const mondayOffset = firstWeekday === 0 ? -6 : 1 - firstWeekday;
    const firstMonday = addDays(start, mondayOffset);

    const dayCount = Math.round((end.getTime() - firstMonday.getTime()) / DAY_IN_MS) + 1;
    const totalDays = Math.ceil(dayCount / 7) * 7;
    const allDays = Array.from({ length: totalDays }, (_, i) => addDays(firstMonday, i));

    const weeks = Array.from({ length: allDays.length / 7 }, (_, i) =>
      allDays.slice(i * 7, i * 7 + 7),
    );

    const totalOpened = allDays.filter(
      (d) => d.getUTCFullYear() === year && activeDates.has(toDateKey(d)),
    ).length;

    return {
      year,
      start,
      end,
      weeks,
      totalOpened,
      todayIso,
    };
  }, [streak?.today, activeDates]);

  useEffect(() => {
    if (view === 'year') {
      const timer = setTimeout(() => {
        yearScrollRef.current?.scrollToEnd({ animated: true });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [view]);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <Pressable
            style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <ArrowLeft size={18} color={Colors.navy} weight="bold" />
          </Pressable>
          <Text style={styles.topBarTitle}>Daily Streak</Text>
          <View style={styles.topBarSpacer} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Colors.navy}
            />
          }
        >
          {/* Hero Card - clean white card matching BharatPath theme */}
          <View style={styles.heroCard}>
            {loading && !streak ? (
              <View style={styles.heroLoading}>
                <ActivityIndicator size="large" color={Colors.navy} />
              </View>
            ) : (
              <>
                {/* Header: Eyebrow + Status Pill */}
                <View style={styles.heroTopRow}>
                  <View style={styles.heroEyebrowGroup}>
                    <Flame size={14} color={flameConfig.color} weight="fill" />
                    <Text style={styles.heroEyebrow}>YOUR STREAK</Text>
                  </View>

                  <View
                    style={[
                      styles.statusPill,
                      {
                        backgroundColor: statusTheme.bg,
                        borderColor: statusTheme.border,
                      },
                    ]}
                  >
                    <View
                      style={[
                        styles.statusDot,
                        { backgroundColor: statusTheme.dot },
                      ]}
                    />
                    <Text
                      style={[
                        styles.statusPillText,
                        { color: statusTheme.text },
                      ]}
                    >
                      {streak ? streakStatusLabel(status) : '-'}
                    </Text>
                  </View>
                </View>

                {/* Centerpiece: Flame Emblem + Streak Count */}
                <View style={styles.heroMainRow}>
                  <View
                    style={[
                      styles.flameEmblem,
                      {
                        backgroundColor: flameConfig.bg,
                        borderColor: flameConfig.border,
                      },
                    ]}
                  >
                    <Flame size={38} color={flameConfig.color} weight="fill" />
                  </View>

                  <View style={styles.heroCounterGroup}>
                    <View style={styles.heroNumberRow}>
                      <Text style={styles.heroNumber}>{current}</Text>
                      <Text style={styles.heroUnit}>
                        {current === 1 ? 'day streak' : 'days streak'}
                      </Text>
                    </View>
                    <Text style={styles.heroSubtitle}>
                      {streak
                        ? streakSubtitle(status, current)
                        : 'Open the app daily to build your streak and earn points.'}
                    </Text>
                  </View>
                </View>

                {/* Dual Stats Tiles */}
                <View style={styles.heroStatsGrid}>
                  <View style={styles.heroStatTile}>
                    <View style={styles.heroStatHeader}>
                      <Lightning size={13} color={Colors.gold} weight="fill" />
                      <Text style={styles.heroStatEyebrow}>POINTS</Text>
                    </View>
                    <Text style={styles.heroStatValue}>
                      {points.toLocaleString('en-IN')}
                    </Text>
                    <Text style={styles.heroStatSub}>Engagement balance</Text>
                  </View>

                  <View style={styles.heroStatTile}>
                    <View style={styles.heroStatHeader}>
                      <Trophy size={13} color={Colors.gold} weight="fill" />
                      <Text style={styles.heroStatEyebrow}>LONGEST</Text>
                    </View>
                    <Text style={styles.heroStatValue}>
                      {longest} {longest === 1 ? 'day' : 'days'}
                    </Text>
                    <Text style={styles.heroStatSub}>Personal best</Text>
                  </View>
                </View>

                {/* Manual check-in - only when not already active today */}
                {status && status !== 'ACTIVE_TODAY' ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.checkInButton,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={handleManualCheckIn}
                    disabled={checkingIn}
                    accessibilityRole="button"
                    accessibilityLabel="Check in today"
                  >
                    {checkingIn ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <>
                        <Lightning size={16} color="#FFFFFF" weight="fill" />
                        <Text style={styles.checkInText}>Check in today</Text>
                      </>
                    )}
                  </Pressable>
                ) : null}
              </>
            )}
          </View>

          {error ? (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Activity Calendar / Heatmap Section */}
          <View style={styles.section}>
            <View style={styles.sectionHeaderRow}>
              <View style={styles.sectionEyebrowRow}>
                <Flame size={13} color="#FF6B00" weight="fill" />
                <Text style={styles.sectionEyebrow}>
                  {view === 'week'
                    ? "THIS WEEK'S ACTIVITY"
                    : view === 'month'
                      ? "THIS MONTH'S ACTIVITY"
                      : "THIS YEAR'S ACTIVITY"}
                </Text>
              </View>

              {/* View Switcher Tabs: Week | Month | Year */}
              <View style={styles.segmentContainer}>
                {(['week', 'month', 'year'] as const).map((period) => {
                  const isSelected = view === period;
                  return (
                    <Pressable
                      key={period}
                      onPress={() => setView(period)}
                      style={[
                        styles.segmentBtn,
                        isSelected && styles.segmentBtnActive,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`View streak by ${period}`}
                    >
                      <Text
                        style={[
                          styles.segmentText,
                          isSelected && styles.segmentTextActive,
                        ]}
                      >
                        {period.charAt(0).toUpperCase() + period.slice(1)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Summary statistics row if calendar data is available */}
            {currentCalendar ? (
              <View style={styles.calendarStatsRow}>
                <Text style={styles.calendarStatsText}>
                  {currentCalendar.active_days} opened · {currentCalendar.missed_days} missed · best run {currentCalendar.longest_run}
                </Text>
              </View>
            ) : null}

            <View style={styles.heatmapCard}>
              {calendarLoading && !currentCalendar ? (
                <View style={styles.calendarLoadingContainer}>
                  <ActivityIndicator size="small" color="#FF6B00" />
                </View>
              ) : null}

              {view === 'week' ? (
                /* Week View */
                <View style={styles.heatmapWeekRow}>
                  {weekDays.map((day) => (
                    <View
                      key={day.dateStr}
                      style={[styles.dayCol, day.isToday && styles.dayColToday]}
                    >
                      <Text
                        style={[
                          styles.dayLabelText,
                          day.isToday && styles.dayLabelTextToday,
                        ]}
                      >
                        {day.dayLabel}
                      </Text>
                      <View
                        style={[
                          styles.dayCircle,
                          day.isActive && styles.dayCircleActive,
                          day.isToday &&
                            !day.isActive &&
                            styles.dayCircleTodayPending,
                          day.isFuture && styles.dayCircleFuture,
                        ]}
                      >
                        {day.isActive ? (
                          <Flame size={14} color="#FFFFFF" weight="fill" />
                        ) : day.isToday ? (
                          <View style={styles.todayPulseDot} />
                        ) : (
                          <View
                            style={[
                              styles.dayDot,
                              day.isFuture && styles.dayDotFuture,
                            ]}
                          />
                        )}
                      </View>
                      <Text
                        style={[
                          styles.dayDateText,
                          day.isToday && styles.dayDateTextToday,
                        ]}
                        numberOfLines={1}
                      >
                        {day.dayNum}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : view === 'month' ? (
                /* Month View */
                <View style={styles.monthContainer}>
                  <View style={styles.monthHeaderRow}>
                    <Text style={styles.monthHeaderTitle}>
                      {monthData.monthName}
                    </Text>
                    <View style={styles.monthOpenedPill}>
                      <Flame size={12} color="#FF6B00" weight="fill" />
                      <Text style={styles.monthOpenedPillText}>
                        {currentCalendar?.active_days ?? monthData.completedCount} opened
                      </Text>
                    </View>
                  </View>

                  {/* Weekday column labels */}
                  <View style={styles.monthWeekdayRow}>
                    {WEEKDAY_LABELS.map((label) => (
                      <Text key={label} style={styles.monthWeekdayText}>
                        {label}
                      </Text>
                    ))}
                  </View>

                  {/* Calendar days grid */}
                  <View style={styles.monthGrid}>
                    {monthData.days.map((day) => {
                      const key = toDateKey(day);
                      const inMonth = day.getUTCMonth() === monthData.month;
                      const isCompleted = inMonth && activeDates.has(key);
                      const isToday = key === monthData.todayIso;
                      const isFuture = key > monthData.todayIso;

                      if (!inMonth) {
                        return (
                          <View key={key} style={styles.monthCellWrapper}>
                            <View style={styles.monthCellEmpty} />
                          </View>
                        );
                      }

                      return (
                        <View key={key} style={styles.monthCellWrapper}>
                          <View
                            style={[
                              styles.monthCell,
                              isCompleted && styles.monthCellActive,
                              isToday &&
                                !isCompleted &&
                                styles.monthCellTodayPending,
                              isToday &&
                                isCompleted &&
                                styles.monthCellTodayActive,
                              isFuture && styles.monthCellFuture,
                              !isCompleted &&
                                !isToday &&
                                !isFuture &&
                                styles.monthCellMissed,
                            ]}
                          >
                            <Text
                              style={[
                                styles.monthCellText,
                                isCompleted && styles.monthCellTextActive,
                                isToday &&
                                  !isCompleted &&
                                  styles.monthCellTextTodayPending,
                                isFuture && styles.monthCellTextFuture,
                              ]}
                            >
                              {day.getUTCDate()}
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ) : (
                /* Year View */
                <View style={styles.yearContainer}>
                  <View style={styles.yearHeaderRow}>
                    <Text style={styles.yearHeaderTitle}>
                      {yearData.year} Heatmap
                    </Text>
                    <View style={styles.yearOpenedPill}>
                      <Flame size={12} color="#FF6B00" weight="fill" />
                      <Text style={styles.yearOpenedPillText}>
                        {currentCalendar?.active_days ?? yearData.totalOpened} opened
                      </Text>
                    </View>
                  </View>

                  <ScrollView
                    ref={yearScrollRef}
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.yearScrollContent}
                  >
                    <View style={styles.yearHeatmapGrid}>
                      {yearData.weeks.map((week, weekIdx) => {
                        const monthStartDay = week.find(
                          (d) =>
                            d.getUTCDate() <= 7 &&
                            d.getUTCDate() >= 1 &&
                            d.getUTCFullYear() === yearData.year &&
                            (d.getUTCDate() === 1 || weekIdx === 0),
                        );

                        const monthLabel = monthStartDay
                          ? new Intl.DateTimeFormat('en-IN', {
                              month: 'short',
                              timeZone: 'UTC',
                            }).format(monthStartDay)
                          : null;

                        return (
                          <View key={weekIdx} style={styles.yearWeekCol}>
                            <View style={styles.yearMonthHeader}>
                              {monthLabel ? (
                                <Text style={styles.yearMonthLabelText}>
                                  {monthLabel}
                                </Text>
                              ) : null}
                            </View>
                            {week.map((day) => {
                              const key = toDateKey(day);
                              const inYear =
                                day >= yearData.start && day <= yearData.end;
                              const isFuture = key > yearData.todayIso;
                              const isCompleted =
                                inYear && !isFuture && activeDates.has(key);
                              const isToday = key === yearData.todayIso;

                              if (!inYear) {
                                return (
                                  <View
                                    key={key}
                                    style={styles.yearSquareEmpty}
                                  />
                                );
                              }

                              return (
                                <View
                                  key={key}
                                  style={[
                                    styles.yearSquare,
                                    isCompleted && styles.yearSquareActive,
                                    isToday &&
                                      !isCompleted &&
                                      styles.yearSquareTodayPending,
                                    isFuture && styles.yearSquareFuture,
                                    !isCompleted &&
                                      !isToday &&
                                      !isFuture &&
                                      styles.yearSquareMissed,
                                  ]}
                                />
                              );
                            })}
                          </View>
                        );
                      })}
                    </View>
                  </ScrollView>

                  {/* Heatmap Legend */}
                  <View style={styles.yearLegendRow}>
                    <Text style={styles.yearLegendText}>Less</Text>
                    <View
                      style={[styles.yearLegendSquare, styles.yearSquareMissed]}
                    />
                    <View
                      style={[styles.yearLegendSquare, styles.yearSquareActive]}
                    />
                    <Text style={styles.yearLegendText}>Active</Text>
                  </View>
                </View>
              )}

              <View style={styles.heatmapFooter}>
                <Text style={styles.heatmapFooterText}>
                  {view === 'week'
                    ? status === 'ACTIVE_TODAY'
                      ? '✓ Today completed! Keep up the daily momentum.'
                      : 'Check in before 11:59 PM IST to keep your streak alive.'
                    : 'Colored days are days you opened the app.'}
                </Text>
              </View>
            </View>
          </View>

          {/* Next milestone progress */}
          {next ? (
            <View style={styles.section}>
              <View style={styles.sectionEyebrowRow}>
                <Trophy size={13} color={Colors.gold} weight="fill" />
                <Text style={styles.sectionEyebrow}>NEXT MILESTONE</Text>
              </View>
              <View style={styles.nextMilestoneCard}>
                <View style={styles.nextMilestoneTop}>
                  <View>
                    <Text style={styles.nextMilestoneDays}>{next.days} days</Text>
                    <Text style={styles.nextMilestoneSub}>Milestone target</Text>
                  </View>
                  <View style={styles.nextMilestonePointsBadge}>
                    <Text style={styles.nextMilestonePointsText}>
                      +{next.points} pts
                    </Text>
                  </View>
                </View>
                <View style={styles.progressBar}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${Math.min(100, (current / next.days) * 100)}%` },
                    ]}
                  />
                </View>
                <View style={styles.progressLabelRow}>
                  <Text style={styles.progressLabel}>
                    {current >= next.days
                      ? 'Milestone reached! 🎉'
                      : `${next.days - current} day${next.days - current === 1 ? '' : 's'} to go`}
                  </Text>
                  <Text style={styles.progressPercentText}>
                    {Math.min(100, Math.round((current / next.days) * 100))}%
                  </Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* Milestone ladder */}
          {milestones.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionEyebrowRow}>
                <Medal size={13} color={Colors.gold} weight="fill" />
                <Text style={styles.sectionEyebrow}>MILESTONES LADDER</Text>
              </View>
              <View style={styles.milestoneLadder}>
                {milestones.map((m, i) => (
                  <MilestoneRow
                    key={m.days}
                    milestone={m}
                    reached={current >= m.days}
                    isLast={i === milestones.length - 1}
                  />
                ))}
              </View>
              {breakPenalty > 0 ? (
                <View style={styles.breakPenaltyBox}>
                  <Flame size={15} color="#993A22" weight="fill" />
                  <Text style={styles.breakPenaltyNote}>
                    Missing a day resets your streak and costs {breakPenalty} points.
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Points history */}
          <View style={styles.section}>
            <View style={styles.sectionEyebrowRow}>
              <Lightning size={13} color={Colors.gold} weight="fill" />
              <Text style={styles.sectionEyebrow}>POINTS HISTORY</Text>
            </View>
            {historyLoading ? (
              <View style={styles.historyLoading}>
                <ActivityIndicator size="small" color={Colors.text.muted} />
              </View>
            ) : history.length === 0 ? (
              <View style={styles.historyEmpty}>
                <Trophy size={32} color={Colors.text.muted} weight="duotone" />
                <Text style={styles.historyEmptyTitle}>No points yet</Text>
                <Text style={styles.historyEmptyBody}>
                  Earn points by reaching streak milestones. Check in daily so you don't miss a day.
                </Text>
              </View>
            ) : (
              <View style={styles.historyList}>
                {history.map((item, i) => (
                  <HistoryRow key={`${item.activity_on}-${i}`} item={item} />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** A single milestone row in the ladder, with a reached indicator. */
function MilestoneRow({
  milestone,
  reached,
  isLast,
}: {
  milestone: StreakMilestone;
  reached: boolean;
  isLast: boolean;
}) {
  return (
    <View
      style={[
        styles.milestoneRow,
        reached && styles.milestoneRowReached,
        isLast && styles.milestoneRowLast,
      ]}
    >
      <View
        style={[
          styles.milestoneDot,
          reached ? styles.milestoneDotReached : styles.milestoneDotPending,
        ]}
      >
        {reached ? (
          <Check size={18} color="#FFFFFF" weight="bold" />
        ) : (
          <Text style={styles.milestoneDotDays}>{milestone.days}</Text>
        )}
      </View>
      <View style={styles.milestoneContent}>
        <View style={styles.milestoneTitleRow}>
          <Text
            style={[
              styles.milestoneTitle,
              reached && styles.milestoneTitleReached,
            ]}
          >
            {milestone.days}-day streak
          </Text>
          {reached && (
            <View style={styles.completedBadge}>
              <Text style={styles.completedBadgeText}>Completed</Text>
            </View>
          )}
        </View>
        <Text
          style={[
            styles.milestonePoints,
            reached && styles.milestonePointsReached,
          ]}
        >
          {reached
            ? `+${milestone.points} pts earned`
            : `+${milestone.points} points reward`}
        </Text>
      </View>
      {reached ? (
        <View style={styles.milestoneBadgeReached}>
          <CheckCircle size={22} color={Colors.green.fg} weight="fill" />
        </View>
      ) : null}
    </View>
  );
}

/** A single points-history row. */
function HistoryRow({ item }: { item: StreakPointsChange }) {
  const isAward = item.kind === 'MILESTONE_AWARD';
  const sign = item.points >= 0 ? '+' : '';
  return (
    <View style={styles.historyRow}>
      <View
        style={[
          styles.historyIcon,
          isAward ? styles.historyIconAward : styles.historyIconPenalty,
        ]}
      >
        {isAward ? (
          <Trophy size={15} color={Colors.gold} weight="fill" />
        ) : (
          <Flame size={15} color={Colors.red.fg} weight="fill" />
        )}
      </View>
      <View style={styles.historyContent}>
        <Text style={styles.historyTitle}>{pointsChangeLabel(item.kind)}</Text>
        <Text style={styles.historyMeta}>
          {item.milestone_days
            ? `${item.milestone_days}-day milestone`
            : `${item.streak_length}-day streak`}{' '}
          · {formatDate(item.activity_on)}
        </Text>
      </View>
      <View
        style={[
          styles.historyPointsPill,
          isAward ? styles.historyPointsPillAward : styles.historyPointsPillPenalty,
        ]}
      >
        <Text
          style={[
            styles.historyPoints,
            isAward ? styles.historyPointsAward : styles.historyPointsPenalty,
          ]}
        >
          {sign}{item.points} pts
        </Text>
      </View>
    </View>
  );
}

/** Formats an ISO date (YYYY-MM-DD) as a short readable date. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.offWhite, // #FFFCF7
  },
  safeArea: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  topBarTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 17,
    lineHeight: 22,
    color: Colors.navy,
  },
  topBarSpacer: {
    width: 40,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xxl + Spacing.xl,
    gap: Spacing.lg,
  },
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: Spacing.xl,
    gap: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  heroLoading: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroEyebrowGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  heroEyebrow: {
    ...Typography.monoEyebrow,
    color: Colors.text.muted,
    fontSize: 11,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 4,
    borderRadius: Radii.pill,
    borderWidth: 1,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusPillText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    lineHeight: 16,
  },
  heroMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.base,
  },
  flameEmblem: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  heroCounterGroup: {
    flex: 1,
    gap: 4,
  },
  heroNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
  },
  heroNumber: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 44,
    lineHeight: 48,
    color: Colors.navy,
    includeFontPadding: false,
  },
  heroUnit: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 22,
    color: Colors.text.muted,
  },
  heroSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.text.muted,
  },
  heroStatsGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  heroStatTile: {
    flex: 1,
    backgroundColor: Colors.surface.tint, // #F7F4EC
    borderRadius: 16,
    padding: Spacing.md,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  heroStatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  heroStatEyebrow: {
    ...Typography.monoEyebrow,
    color: Colors.text.muted,
    fontSize: 10,
  },
  heroStatValue: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 22,
    lineHeight: 26,
    color: Colors.navy,
    includeFontPadding: false,
  },
  heroStatSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    lineHeight: 14,
    color: Colors.text.muted,
  },
  checkInButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs + 2,
    backgroundColor: Colors.purple, // #5F4DB2
    paddingVertical: Spacing.sm + 4,
    borderRadius: Radii.pill,
    shadowColor: Colors.purple,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  checkInText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  errorBanner: {
    backgroundColor: Colors.red.bg,
    borderRadius: Radii.tile,
    padding: Spacing.base,
  },
  errorText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.red.fg,
  },
  section: {
    gap: Spacing.sm + 2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    gap: Spacing.sm,
  },
  sectionEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
  },
  sectionEyebrow: {
    ...Typography.monoEyebrow,
    color: Colors.text.muted,
    fontSize: 11,
  },
  segmentContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1ECE2',
    borderRadius: Radii.pill,
    padding: 3,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  segmentBtn: {
    paddingHorizontal: 11,
    paddingVertical: 5,
    borderRadius: Radii.pill,
  },
  segmentBtnActive: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    lineHeight: 14,
    color: Colors.text.muted,
  },
  segmentTextActive: {
    fontFamily: 'GeneralSans-Semibold',
    color: Colors.navy,
  },
  calendarStatsRow: {
    paddingHorizontal: 4,
    marginTop: -2,
  },
  calendarStatsText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    lineHeight: 15,
    color: Colors.text.muted,
  },
  calendarLoadingContainer: {
    paddingVertical: Spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heatmapCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radii.card,
    paddingVertical: Spacing.base,
    paddingHorizontal: Spacing.sm + 2,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  heatmapWeekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  dayCol: {
    flex: 1,
    alignItems: 'center',
    gap: 5,
    paddingVertical: 4,
    paddingHorizontal: 1,
    borderRadius: 10,
    minWidth: 0,
  },
  dayColToday: {
    backgroundColor: '#FFF8F0',
  },
  dayLabelText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    lineHeight: 14,
    color: Colors.text.muted,
  },
  dayLabelTextToday: {
    color: '#FF6B00',
    fontFamily: 'GeneralSans-Bold',
  },
  dayCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surface.tint,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  dayCircleActive: {
    backgroundColor: '#FF6B00',
    borderColor: '#FF8A33',
    shadowColor: '#FF6B00',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 2,
  },
  dayCircleTodayPending: {
    borderColor: '#FF6B00',
    borderWidth: 1.5,
    backgroundColor: '#FFF3E8',
  },
  dayCircleFuture: {
    backgroundColor: '#FAF7F0',
    borderColor: '#EFEAE0',
    opacity: 0.6,
  },
  todayPulseDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#FF6B00',
  },
  dayDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#C5CBD6',
  },
  dayDotFuture: {
    backgroundColor: '#E2E5EA',
  },
  dayDateText: {
    fontFamily: 'SpaceMono-Regular',
    fontSize: 10,
    lineHeight: 12,
    color: Colors.text.muted,
  },
  dayDateTextToday: {
    color: Colors.navy,
    fontFamily: 'SpaceMono-Bold',
  },
  heatmapFooter: {
    paddingTop: Spacing.xs,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.hairline,
  },
  heatmapFooterText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.text.muted,
    textAlign: 'center',
  },
  monthContainer: {
    gap: Spacing.sm,
  },
  monthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 2,
  },
  monthHeaderTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
  },
  monthOpenedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF3E8',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: '#FFE0C2',
  },
  monthOpenedPillText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 11,
    lineHeight: 14,
    color: '#FF6B00',
  },
  monthWeekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  monthWeekdayText: {
    width: '14.28%',
    textAlign: 'center',
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    lineHeight: 14,
    color: Colors.text.muted,
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 6,
  },
  monthCellWrapper: {
    width: '14.28%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthCell: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  monthCellEmpty: {
    width: 34,
    height: 34,
  },
  monthCellActive: {
    backgroundColor: '#FF6B00',
    borderColor: '#FF8A33',
    shadowColor: '#FF6B00',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 2,
  },
  monthCellTodayPending: {
    backgroundColor: '#FFF3E8',
    borderColor: '#FF6B00',
    borderWidth: 1.5,
  },
  monthCellTodayActive: {
    backgroundColor: '#FF6B00',
    borderColor: '#FFFFFF',
    borderWidth: 2,
    shadowColor: '#FF6B00',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 3,
  },
  monthCellMissed: {
    backgroundColor: Colors.surface.tint,
    borderColor: Colors.surface.border,
  },
  monthCellFuture: {
    backgroundColor: '#FAF7F0',
    borderColor: '#EFEAE0',
    opacity: 0.7,
  },
  monthCellText: {
    fontFamily: 'SpaceMono-Regular',
    fontSize: 11,
    lineHeight: 14,
    color: Colors.text.muted,
  },
  monthCellTextActive: {
    color: '#FFFFFF',
    fontFamily: 'SpaceMono-Bold',
  },
  monthCellTextTodayPending: {
    color: '#FF6B00',
    fontFamily: 'SpaceMono-Bold',
  },
  monthCellTextFuture: {
    color: '#B8B1A4',
  },
  yearContainer: {
    gap: Spacing.sm,
  },
  yearHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 2,
  },
  yearHeaderTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
  },
  yearOpenedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFF3E8',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: '#FFE0C2',
  },
  yearOpenedPillText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 11,
    lineHeight: 14,
    color: '#FF6B00',
  },
  yearScrollContent: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  yearHeatmapGrid: {
    flexDirection: 'row',
    gap: 3,
  },
  yearWeekCol: {
    gap: 3,
    alignItems: 'center',
  },
  yearMonthHeader: {
    height: 16,
    justifyContent: 'center',
    alignItems: 'flex-start',
    width: '100%',
  },
  yearMonthLabelText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 9,
    lineHeight: 12,
    color: Colors.text.muted,
  },
  yearSquare: {
    width: 12,
    height: 12,
    borderRadius: 2.5,
    borderWidth: 1,
  },
  yearSquareEmpty: {
    width: 12,
    height: 12,
  },
  yearSquareActive: {
    backgroundColor: '#FF6B00',
    borderColor: '#FF8A33',
  },
  yearSquareTodayPending: {
    backgroundColor: '#FFF3E8',
    borderColor: '#FF6B00',
    borderWidth: 1,
  },
  yearSquareMissed: {
    backgroundColor: Colors.surface.tint,
    borderColor: Colors.surface.border,
  },
  yearSquareFuture: {
    backgroundColor: '#FAF7F0',
    borderColor: '#EFEAE0',
  },
  yearLegendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
    paddingTop: 4,
    paddingHorizontal: 4,
  },
  yearLegendSquare: {
    width: 10,
    height: 10,
    borderRadius: 2,
    borderWidth: 1,
  },
  yearLegendText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 10,
    lineHeight: 13,
    color: Colors.text.muted,
  },
  nextMilestoneCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radii.card,
    padding: Spacing.lg,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  nextMilestoneTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  nextMilestoneDays: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 20,
    lineHeight: 24,
    color: Colors.navy,
  },
  nextMilestoneSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.text.muted,
  },
  nextMilestonePointsBadge: {
    backgroundColor: '#FEF3C7',
    borderWidth: 1,
    borderColor: '#FDE68A',
    paddingHorizontal: Spacing.sm + 4,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  nextMilestonePointsText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 12,
    lineHeight: 15,
    color: '#92400E',
  },
  progressBar: {
    height: 8,
    backgroundColor: Colors.surface.hairline,
    borderRadius: Radii.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.gold,
    borderRadius: Radii.pill,
  },
  progressLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  progressLabel: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.text.muted,
  },
  progressPercentText: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.gold,
  },
  milestoneLadder: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radii.card,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.hairline,
  },
  milestoneRowReached: {
    backgroundColor: '#F3FAF6',
    borderRadius: 14,
    borderBottomColor: 'transparent',
    borderWidth: 1,
    borderColor: '#D4EBDC',
    marginVertical: 2,
  },
  milestoneRowLast: {
    borderBottomWidth: 0,
  },
  milestoneDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  milestoneDotReached: {
    backgroundColor: Colors.green.fg, // #1F6B45
    shadowColor: Colors.green.fg,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 2,
  },
  milestoneDotPending: {
    backgroundColor: Colors.surface.tint,
    borderWidth: 1,
    borderColor: Colors.surface.borderSecondary,
  },
  milestoneDotDays: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 11,
    lineHeight: 14,
    color: Colors.text.muted,
  },
  milestoneContent: {
    flex: 1,
    gap: 2,
  },
  milestoneTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  milestoneTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
  },
  milestoneTitleReached: {
    color: Colors.green.fg,
    fontFamily: 'GeneralSans-Bold',
  },
  completedBadge: {
    backgroundColor: Colors.green.bg,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: '#C6E3D1',
  },
  completedBadgeText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 11,
    color: Colors.green.fg,
  },
  milestonePoints: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.text.muted,
  },
  milestonePointsReached: {
    color: Colors.green.fg,
    fontFamily: 'GeneralSans-Medium',
  },
  milestoneBadgeReached: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.green.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  breakPenaltyBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.red.bg,
    borderWidth: 1,
    borderColor: 'rgba(153, 58, 34, 0.2)',
    borderRadius: Radii.card,
    padding: Spacing.md,
  },
  breakPenaltyNote: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.red.fg,
  },
  historyLoading: {
    paddingVertical: Spacing.xl,
    alignItems: 'center',
  },
  historyEmpty: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radii.card,
    padding: Spacing.xl,
    alignItems: 'center',
    gap: Spacing.xs + 2,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  historyEmptyTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
  },
  historyEmptyBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.text.muted,
    textAlign: 'center',
  },
  historyList: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radii.card,
    padding: Spacing.base,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.hairline,
  },
  historyIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyIconAward: {
    backgroundColor: '#FEF3C7',
  },
  historyIconPenalty: {
    backgroundColor: Colors.red.bg,
  },
  historyContent: {
    flex: 1,
    gap: 2,
  },
  historyTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 18,
    color: Colors.navy,
  },
  historyMeta: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.text.muted,
  },
  historyPointsPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
  },
  historyPointsPillAward: {
    backgroundColor: '#FEF3C7',
  },
  historyPointsPillPenalty: {
    backgroundColor: Colors.red.bg,
  },
  historyPoints: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 13,
    lineHeight: 18,
    includeFontPadding: false,
  },
  historyPointsAward: {
    color: '#92400E',
  },
  historyPointsPenalty: {
    color: Colors.red.fg,
  },
});
