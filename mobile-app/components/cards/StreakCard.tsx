/**
 * BharatPath - StreakCard
 *
 * Compact streak summary for the home dashboard. Shows the current day streak,
 * the engagement-points balance, and the next milestone, with a status pill
 * that reflects the backend's `StreakStatus`.
 *
 * Engagement points are a SEPARATE balance from the 700–990 candidate score
 * and must never be rendered beside it (`docs/streaks.md` §2). This card uses
 * the word "points", never "score".
 *
 * The card is tappable and opens the full streak detail screen.
 */
import {
  Pressable,
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Flame, CaretRight, Trophy } from 'phosphor-react-native';
import { Colors, Radii, Spacing, Typography } from '@/theme/tokens';
import { StreakResponse, StreakStatus } from '@/types/streak';
import { streakStatusLabel } from '@/services/api/streak';

interface StreakCardProps {
  streak: StreakResponse | null;
  loading?: boolean;
  onPress?: () => void;
}

/** Background + text colour + dot per status, used for the status pill. */
function statusPillStyle(status: StreakStatus | undefined) {
  if (status === 'ACTIVE_TODAY') {
    return {
      bg: Colors.green.bg,
      fg: Colors.green.fg,
      dot: Colors.green.fg,
      border: 'rgba(31, 107, 69, 0.2)',
    };
  }
  if (status === 'AT_RISK') {
    return {
      bg: Colors.amber.bg,
      fg: Colors.amber.fg,
      dot: Colors.amber.fg,
      border: 'rgba(122, 92, 14, 0.2)',
    };
  }
  if (status === 'BROKEN') {
    return {
      bg: Colors.red.bg,
      fg: Colors.red.fg,
      dot: Colors.red.fg,
      border: 'rgba(153, 58, 34, 0.2)',
    };
  }
  // NONE / unknown - neutral.
  return {
    bg: Colors.surface.tint,
    fg: Colors.text.muted,
    dot: Colors.text.muted,
    border: 'transparent',
  };
}

/** Visual styling for the flame badge based on status */
function getFlameConfig(status: StreakStatus | undefined) {
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

export function StreakCard({ streak, loading, onPress }: StreakCardProps) {
  const status = streak?.status;
  const pill = statusPillStyle(status);
  const flameConfig = getFlameConfig(status);
  const current = streak?.current_streak ?? 0;
  const points = streak?.points_balance ?? 0;
  const next = streak?.next_milestone;
  const longest = streak?.longest_streak ?? 0;
  const progressPct = next
    ? Math.min(100, Math.round((current / next.days) * 100))
    : 0;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Open streak details"
    >
      {/* Header row: eyebrow + status pill */}
      <View style={styles.headerRow}>
        <View style={styles.eyebrowRow}>
          <Flame size={14} color="#FF6B00" weight="fill" />
          <Text style={styles.eyebrow}>DAILY STREAK</Text>
        </View>
        <View
          style={[
            styles.statusPill,
            { backgroundColor: pill.bg, borderColor: pill.border },
          ]}
        >
          <View style={[styles.statusDot, { backgroundColor: pill.dot }]} />
          <Text style={[styles.statusPillText, { color: pill.fg }]}>
            {streak ? streakStatusLabel(status) : '-'}
          </Text>
        </View>
      </View>

      {/* Body: streak count + points balance */}
      <View style={styles.bodyRow}>
        {loading && !streak ? (
          <ActivityIndicator size="small" color={Colors.navy} />
        ) : (
          <View style={styles.streakCol}>
            <View
              style={[
                styles.flameBadge,
                {
                  backgroundColor: flameConfig.bg,
                  borderColor: flameConfig.border,
                },
              ]}
            >
              <Flame size={22} color={flameConfig.color} weight="fill" />
            </View>
            <View style={styles.streakTextGroup}>
              <Text style={styles.streakNumber}>{current}</Text>
              <Text style={styles.streakUnit}>
                {current === 1 ? 'Day Streak' : 'Days Streak'}
              </Text>
            </View>
          </View>
        )}

        {/* Compact points balance */}
        <View style={styles.pointsCol}>
          <Text style={styles.pointsValue}>
            {points.toLocaleString('en-IN')} pts
          </Text>
          {longest > 0 ? (
            <Text style={styles.longestText}>Longest Streak: {longest}d</Text>
          ) : null}
        </View>
      </View>

      {/* Next milestone progress row */}
      {next ? (
        <View style={styles.milestoneRow}>
          <View style={styles.milestoneLeft}>
            <Trophy size={13} color={Colors.gold} weight="fill" />
            <Text style={styles.milestoneText} numberOfLines={1}>
              Next: {next.days}d (+{next.points} pts)
            </Text>
          </View>
          <View style={styles.progressContainer}>
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${progressPct}%` }]}
              />
            </View>
          </View>
          <CaretRight size={14} color={Colors.text.muted} weight="bold" />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface.card,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    borderRadius: Radii.card,
    padding: Spacing.base + 2,
    gap: Spacing.md,
    width: '100%',
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  pressed: {
    opacity: 0.94,
    transform: [{ scale: 0.99 }],
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  eyebrow: {
    ...Typography.monoEyebrow,
    color: Colors.text.muted,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: Spacing.sm + 2,
    paddingVertical: 3,
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
    fontSize: 11,
    lineHeight: 14,
  },
  bodyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  streakCol: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm + 2,
  },
  flameBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  streakTextGroup: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
  },
  streakNumber: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 28,
    lineHeight: 32,
    color: Colors.navy,
    includeFontPadding: false,
  },
  streakUnit: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 18,
    color: Colors.text.muted,
  },
  pointsCol: {
    flexGrow: 1,
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 2,
  },
  pointsValue: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 18,
    lineHeight: 22,
    color: Colors.navy,
    includeFontPadding: false,
  },
  longestText: {
    textAlign: 'right',
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    lineHeight: 14,
    color: Colors.text.muted,
  },
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.sm + 2,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.hairline,
  },
  milestoneLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  milestoneText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.navy,
  },
  progressContainer: {
    flex: 1,
    paddingHorizontal: 4,
  },
  progressTrack: {
    height: 5,
    backgroundColor: Colors.surface.hairline,
    borderRadius: Radii.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.gold,
    borderRadius: Radii.pill,
  },
});
