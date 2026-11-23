import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Svg, { Circle as SvgCircle, Defs, LinearGradient, Stop } from 'react-native-svg';
import { ShareNetwork, ArrowRight, TrendUp } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { bandIndex, bandLabel, nextBandLabel, pointsToNextBand } from '@/services/api/scoring';

/**
 * NOT YET FUNCTIONAL END TO END. `score` and `band` come from
 * `GET /candidate/score/me`, and that endpoint answers PENDING until a score
 * row exists. When it is PENDING this screen shows a dash - never a stand-in
 * number, because a plausible wrong score is unfixable once a candidate has
 * seen it (`docs/scoring-approach.md` §11).
 *
 * To make a real number appear, three things are needed and none of them are
 * in this app:
 *
 *   1. The outbox must be drained. Confirming a resume only writes a
 *      `resume.version_confirmed` row; nothing publishes it locally.
 *   2. A Celery worker must be running to execute `scoring.score_resume`.
 *      Both of the above: `backend/scripts/dev_workers.sh`.
 *   3. Layer 1 must be switched on in `backend/.env`, because there is
 *      deliberately no fallback extractor:
 *        SCORING_EXTRACTION_ENABLED=true
 *        SCORING_EXTRACTION_PROVIDER=openai
 *        SCORING_MODEL_ID=gpt-5.4-mini-2026-03-17
 *        OPENAI_API_KEY=<key>
 *
 * The `recalculated` mode and the breakdown sheet below are still design
 * mock-ups. They cannot be wired: the client removed score explanation
 * (2026-08-27, re-confirmed 2026-09-11), so the backend serves the number and
 * the band and has no breakdown endpoint at all - `test_score_never_explained`
 * fails the build on a field that would add one.
 */

interface ScoreRevealScreenProps {
  score?: number;
  band?: string | null;
  mode?: 'initial' | 'recalculated';
  onSave?: () => void;
  onShare?: () => void;
  onRaiseScore?: () => void;
  onAllCategories?: () => void;
  onNextFix?: () => void;
}

export function ScoreRevealScreen({
  score,
  band,
  mode = 'initial',
  onSave,
  onShare,
  onRaiseScore,
  onAllCategories,
  onNextFix,
}: ScoreRevealScreenProps) {
  const isRecalculated = mode === 'recalculated';
  const isLive = score != null && !isRecalculated;
  // No score yet means no number. See the note at the top of this file.
  const isPending = score == null && !isRecalculated;
  const targetScore = score ?? (isRecalculated ? 706 : 0);
  const initialScore = isLive ? Math.max(700, targetScore - 40) : isRecalculated ? 680 : 0;
  const shownBand = bandLabel(band) || (isRecalculated ? 'Developing' : '-');
  const shownBandIndex = band ? bandIndex(band) : 0;
  const remaining = pointsToNextBand(targetScore, band || null);
  const followingBand = nextBandLabel(band || null);
  
  const [scoreNow, setScoreNow] = useState(initialScore);

  // Count-up animation. Skipped while pending: there is nothing to count to.
  useEffect(() => {
    if (isPending) return;
    let current = initialScore;
    const interval = setInterval(() => {
      current += Math.max(1, Math.round((targetScore - current) / 5));
      if (current >= targetScore) {
        current = targetScore;
        clearInterval(interval);
      }
      setScoreNow(current);
    }, 32);

    return () => clearInterval(interval);
  }, [targetScore, initialScore, isPending]);

  return (
    <View style={[styles.root, isRecalculated && styles.rootRecalculated]}>
      <StatusBar style={isRecalculated ? 'dark' : 'light'} animated />
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Dark Section */}
          <View style={styles.topSection}>
            {/* Header Row */}
            <View style={styles.headerRow}>
              <View style={styles.headerTitleCol}>
                <Text style={[styles.title, isRecalculated && styles.titleRecalculated]}>
                  {isRecalculated ? 'Your Bharatpath Score went up' : 'Your Bharatpath Score'}
                </Text>
                <Text style={[styles.subtitle, isRecalculated && styles.subtitleRecalculated]}>
                  {isRecalculated
                    ? '3 skills added. Recalculated instantly.'
                    : 'Every fix moves you up.'}
                </Text>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.shareButton,
                  isRecalculated && styles.shareButtonRecalc,
                  pressed && styles.buttonPressed,
                ]}
                onPress={onShare}
                accessibilityRole="button"
                accessibilityLabel="Share Bharatpath Score"
              >
                <ShareNetwork size={16} color={isRecalculated ? '#0A1931' : '#FFFFFF'} weight="bold" />
              </Pressable>
            </View>

            {/* Circular Gauge Ring Display */}
            <View style={styles.gaugeContainer}>
              {/* Radial glow background effect */}
              <View style={styles.radialGlow} />

              <Svg width={190} height={190} viewBox="0 0 120 120" style={styles.svgRing}>
                <Defs>
                  <LinearGradient id="scoreArcGradient" x1="0" y1="0" x2="1" y2="1">
                    <Stop offset="0%" stopColor="#FFF6DC" />
                    <Stop offset="52%" stopColor="#F4D685" />
                    <Stop offset="100%" stopColor="#D4AF37" />
                  </LinearGradient>
                </Defs>

                {/* Track Circle */}
                <SvgCircle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke="rgba(255, 252, 247, 0.12)"
                  strokeWidth="10"
                />

                {/* Animated Score Arc Circle */}
                <SvgCircle
                  cx="60"
                  cy="60"
                  r="52"
                  fill="none"
                  stroke="url(#scoreArcGradient)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray="326.7"
                  strokeDashoffset="95"
                />
              </Svg>

              <View style={styles.gaugeCenterContent}>
                <Text style={styles.scoreNumberText}>{isPending ? '-' : scoreNow}</Text>
                {isRecalculated ? (
                  <View style={styles.pointsBadge}>
                    <TrendUp size={12} color="#F4D685" weight="bold" />
                    <Text style={styles.pointsBadgeText}>+26 POINTS</Text>
                  </View>
                ) : (
                  <Text style={styles.outOfText}>{isPending ? 'NOT SCORED YET' : 'OUT OF 1000'}</Text>
                )}
              </View>
            </View>

            {/* Band Status Section */}
            <View style={styles.bandStatusSection}>
              <View style={styles.bandTitleRow}>
                <Text style={styles.bandTitle}>{shownBand}</Text>
                <View style={styles.bandBadge}>
                  <Text style={styles.bandBadgeText}>BAND {shownBandIndex} OF 4</Text>
                </View>
              </View>

              <View style={styles.bandSegmentsRow}>
                {[1, 2, 3, 4].map((n) => (
                  <View
                    key={n}
                    style={[
                      styles.bandSegment,
                      n <= shownBandIndex ? styles.segmentActiveGold : styles.segmentInactiveDark,
                    ]}
                  />
                ))}
              </View>

              <View style={styles.bandMetaRow}>
                <Text style={styles.bandMetaLeft}>Employers filter by band</Text>
                <Text style={styles.bandMetaRight}>
                  {remaining != null && followingBand
                    ? `${remaining} to ${followingBand}`
                    : 'Top band'}
                </Text>
              </View>
            </View>
          </View>

          {/* Bottom Overlapping White Card Sheet */}
          <View style={styles.whiteSheet}>
            <View style={styles.sheetHeaderRow}>
              <Text style={styles.sheetEyebrow}>
                {isRecalculated
                  ? 'WHAT THIS FIX CHANGED'
                  : isPending
                    ? 'Bharatpath Score pending'
                    : isLive
                      ? 'Your Bharatpath Score'
                      : 'WHERE YOUR POINTS COME FROM'}
              </Text>
              {!isLive && !isPending && (
                <Text style={styles.sheetCountText}>
                  {isRecalculated ? 'FIX 1 OF 3' : '3 OF 5'}
                </Text>
              )}
            </View>

            {isRecalculated ? (
              <View style={styles.recalculatedCard}>
                <View style={styles.recalcTopSection}>
                  <View style={styles.itemHeaderRow}>
                    <View style={styles.itemLabelRow}>
                      <Text style={styles.itemCategoryTitle}>Skills</Text>
                      <View style={[styles.statusBadge, styles.badgeStrong]}>
                        <Text style={[styles.statusBadgeText, styles.badgeTextStrong]}>
                          +26
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.itemScoreText}>
                      74 <Text style={styles.itemScoreMax}>/ 100</Text>
                    </Text>
                  </View>
                  <View style={styles.itemProgressTrack}>
                    <View style={[styles.itemProgressFill, styles.fillAmber, { width: '48%', position: 'absolute', left: 0 }]} />
                    <View style={[styles.itemProgressFill, styles.fillGreen, { width: '26%', position: 'absolute', left: '48%' }]} />
                  </View>
                </View>

                <View style={styles.recalcMiddleSection}>
                  <Text style={styles.recalcMiddleText}>4 more jobs now open to you</Text>
                  <Text style={styles.recalcMiddleSubText}>Pune</Text>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.recalcBottomSection,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={onRaiseScore}
                >
                  <Text style={styles.recalcBottomText}>Two fixes left, worth +32</Text>
                  <ArrowRight size={15} color="#5F6B80" weight="bold" />
                </Pressable>
              </View>
            ) : isLive ? (
              <View style={styles.liveNoteCard}>
                <Text style={styles.liveNoteText}>
                  This is the Bharatpath Score employers see, with your band. There is no
                  category breakdown - the Bharatpath Score is shown as a single value.
                </Text>
              </View>
            ) : isPending ? (
              <View style={styles.liveNoteCard}>
                <Text style={styles.liveNoteText}>
                  Your resume is confirmed, but no Bharatpath Score has been computed yet.
                  Nothing is shown here until there is a real one.
                </Text>
              </View>
            ) : (
              <View style={styles.breakdownCard}>
                {/* Item 1: Education */}
                <View style={styles.breakdownItem}>
                  <View style={styles.itemHeaderRow}>
                    <View style={styles.itemLabelRow}>
                      <Text style={styles.itemCategoryTitle}>Education</Text>
                      <View style={[styles.statusBadge, styles.badgeStrong]}>
                        <Text style={[styles.statusBadgeText, styles.badgeTextStrong]}>
                          STRONG
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.itemScoreText}>
                      72 <Text style={styles.itemScoreMax}>/ 100</Text>
                    </Text>
                  </View>
                  <View style={styles.itemProgressTrack}>
                    <View style={[styles.itemProgressFill, styles.fillGreen, { width: '72%' }]} />
                  </View>
                </View>

                {/* Item 2: Skills */}
                <View style={[styles.breakdownItem, styles.itemBorderTop]}>
                  <View style={styles.itemHeaderRow}>
                    <View style={styles.itemLabelRow}>
                      <Text style={styles.itemCategoryTitle}>Skills</Text>
                      <View style={[styles.statusBadge, styles.badgeNeedsWork]}>
                        <Text style={[styles.statusBadgeText, styles.badgeTextNeedsWork]}>
                          NEEDS WORK
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.itemScoreText}>
                      48 <Text style={styles.itemScoreMax}>/ 100</Text>
                    </Text>
                  </View>
                  <View style={styles.itemProgressTrack}>
                    <View style={[styles.itemProgressFill, styles.fillAmber, { width: '48%' }]} />
                  </View>
                </View>

                {/* Item 3: Experience */}
                <View style={[styles.breakdownItem, styles.itemBorderTop]}>
                  <View style={styles.itemHeaderRow}>
                    <View style={styles.itemLabelRow}>
                      <Text style={styles.itemCategoryTitle}>Experience</Text>
                      <View style={[styles.statusBadge, styles.badgeWeak]}>
                        <Text style={[styles.statusBadgeText, styles.badgeTextWeak]}>
                          WEAK
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.itemScoreText}>
                      15 <Text style={styles.itemScoreMax}>/ 100</Text>
                    </Text>
                  </View>
                  <View style={styles.itemProgressTrack}>
                    <View style={[styles.itemProgressFill, styles.fillRed, { width: '15%' }]} />
                  </View>
                </View>

                {/* Footer Button: All five categories */}
                <Pressable
                  style={({ pressed }) => [
                    styles.allCategoriesButton,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={onAllCategories}
                >
                  <Text style={styles.allCategoriesText}>All five categories</Text>
                  <ArrowRight size={15} color="#5F6B80" weight="bold" />
                </Pressable>
              </View>
            )}

            {/* Bottom Actions Row */}
            <View style={styles.actionsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.raiseScoreButton,
                  pressed && styles.raisePressed,
                  { width: '100%', flex: undefined }
                ]}
                onPress={onSave}
              >
                <Text style={styles.raiseScoreButtonText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const ACCENT_PURPLE = '#5F4DB2';

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#5F4DB2', // #5F4DB2 matching BharatPath R_26Aug2026.dc.html
  },
  rootRecalculated: {
    backgroundColor: '#FFFCF7',
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
  },
  topSection: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 24,
    alignItems: 'center',
    gap: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
    gap: 12,
  },
  headerTitleCol: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.8,
    color: '#FFFFFF',
  },
  titleRecalculated: {
    color: '#0A1931',
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#DCD6F4',
  },
  subtitleRecalculated: {
    color: '#5F6B80',
  },
  shareButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 252, 247, 0.26)',
    backgroundColor: 'rgba(255, 252, 247, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareButtonRecalc: {
    borderColor: '#DDD6C7',
    backgroundColor: '#FFFFFF',
  },
  gaugeContainer: {
    width: 190,
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    marginVertical: 4,
  },
  radialGlow: {
    position: 'absolute',
    width: 154,
    height: 154,
    borderRadius: 77,
    backgroundColor: 'rgba(244, 214, 133, 0.15)',
  },
  svgRing: {
    position: 'absolute',
    transform: [{ rotate: '-90deg' }],
  },
  gaugeCenterContent: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  scoreNumberText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 56,
    lineHeight: 56,
    letterSpacing: -2,
    color: '#FFFFFF',
  },
  scoreNumberTextRecalc: {
    color: '#0A1931',
  },
  outOfText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.6,
    color: '#DCD6F4',
  },
  bandStatusSection: {
    width: '100%',
    gap: 10,
  },
  bandTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  bandTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.7,
    color: '#FFFFFF',
  },
  bandBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radii.pill, // 999
    backgroundColor: 'rgba(244, 214, 133, 0.16)',
  },
  bandBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.0,
    color: '#F4D685',
  },
  bandSegmentsRow: {
    flexDirection: 'row',
    gap: 4,
    width: '100%',
  },
  bandSegment: {
    flex: 1,
    height: 5,
    borderRadius: Radii.pill,
  },
  segmentActiveGold: {
    backgroundColor: '#F4D685',
  },
  segmentInactiveDark: {
    backgroundColor: 'rgba(255, 252, 247, 0.16)',
  },
  bandMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    width: '100%',
  },
  bandMetaLeft: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#DCD6F4',
  },
  bandMetaRight: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    lineHeight: 16,
    color: '#FFFCF7',
  },
  whiteSheet: {
    flex: 1,
    backgroundColor: '#FFFCF7',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
    gap: 12,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  sheetEyebrow: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.32,
    color: '#5F6B80',
  },
  sheetCountText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    lineHeight: 14,
    color: '#5F6B80',
  },
  breakdownCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    paddingHorizontal: 16,
  },
  liveNoteCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 16,
  },
  liveNoteText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#3A4761',
  },
  breakdownItem: {
    paddingVertical: 12,
    gap: 10,
  },
  itemBorderTop: {
    borderTopWidth: 1,
    borderTopColor: '#F0EBDF',
  },
  itemHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  itemCategoryTitle: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    lineHeight: 18,
    color: '#0A1931',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  badgeStrong: {
    backgroundColor: '#E6F1EA',
  },
  badgeTextStrong: {
    color: '#1F6B45',
  },
  badgeNeedsWork: {
    backgroundColor: '#F7EFD6',
  },
  badgeTextNeedsWork: {
    color: '#7A5C0E',
  },
  badgeWeak: {
    backgroundColor: '#F8E6E0',
  },
  badgeTextWeak: {
    color: '#993A22',
  },
  statusBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: 1.0,
  },
  itemScoreText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    lineHeight: 18,
    color: '#0A1931',
  },
  itemScoreMax: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  itemProgressTrack: {
    height: 4,
    borderRadius: Radii.pill,
    backgroundColor: '#F0EBDF',
    overflow: 'hidden',
  },
  itemProgressFill: {
    height: '100%',
    borderRadius: Radii.pill,
  },
  fillGreen: {
    backgroundColor: '#1F6B45',
  },
  fillAmber: {
    backgroundColor: '#B9891A',
  },
  fillRed: {
    backgroundColor: '#993A22',
  },
  allCategoriesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0EBDF',
  },
  allCategoriesText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 18,
    color: '#0A1931',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 20,
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
    paddingVertical: 16,
    borderRadius: Radii.pill, // 999
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  saveButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#0A1931',
  },
  raiseScoreButton: {
    flex: 1.5,
    backgroundColor: ACCENT_PURPLE, // #5F4DB2
    paddingVertical: 18,
    borderRadius: Radii.pill, // 999
    alignItems: 'center',
    justifyContent: 'center',
  },
  raisePressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  raiseScoreButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  pointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pointsBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 0.8,
    color: '#0A1931',
  },
  recalculatedCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    overflow: 'hidden',
  },
  recalcTopSection: {
    padding: 16,
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EBDF',
  },
  recalcMiddleSection: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  recalcMiddleText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    lineHeight: 18,
    color: '#0A1931',
  },
  recalcMiddleSubText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  recalcBottomSection: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0EBDF',
  },
  recalcBottomText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 18,
    color: '#0A1931',
  },
});
