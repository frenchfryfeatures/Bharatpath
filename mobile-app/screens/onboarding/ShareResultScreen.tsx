import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
  Switch,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, DownloadSimple, ShareNetwork } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';

/**
 * `score` and `bandName` come from `GET /candidate/score/me` via the caller.
 * Until a score exists the card shows a dash rather than a stand-in number -
 * see the note in `ScoreRevealScreen.tsx` for what has to run to produce one.
 *
 * `candidateField` and `candidateCity` are still placeholders. A city can be
 * read from `GET /candidate/profile`; the field of study has no endpoint and
 * would have to come from the confirmed resume version's education.
 */
export interface ShareResultScreenProps {
  score?: number;
  maxScore?: number;
  bandName?: string;
  candidateName?: string;
  candidateField?: string;
  candidateCity?: string;
  scoreDate?: string;
  onBack?: () => void;
  onSave?: () => void;
  onShare?: () => void;
}

export function ShareResultScreen({
  score,
  maxScore = 990,
  bandName,
  candidateName,
  candidateField,
  candidateCity,
  scoreDate,
  onBack,
  onSave,
  onShare,
}: ShareResultScreenProps) {
  const [showExact, setShowExact] = useState(false);

  const sanitizeField = (field?: string) => {
    if (!field) return '';
    return field
      .replace(/\s*[({\[]\s*$/, '')
      .replace(/[,·•|-]\s*$/, '')
      .trim();
  };

  const detailsParts = [candidateName, sanitizeField(candidateField), candidateCity]
    .map((p) => p?.trim())
    .filter((p): p is string => Boolean(p));
  const detailsLine = detailsParts.join(' · ');

  const formattedDate = scoreDate?.trim() || (() => {
    const now = new Date();
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${months[now.getMonth()]} ${now.getFullYear()}`;
  })();

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Navigation Bar */}
          <View style={styles.topBar}>
            <Pressable
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={16} color={Colors.navy} weight="bold" />
            </Pressable>
            <Text style={styles.navTitle}>Share your result</Text>
          </View>

          {/* Social Share Card - Solid deep indigo matching screenshot */}
          <View style={styles.shareCard}>
            {/* Top Brand Logo Row */}
            <View style={styles.brandRow}>
              <Image
                source={require('../../assets/icons/bharatpath-icon.png')}
                style={styles.logoMark}
                resizeMode="contain"
              />
              <Text style={styles.brandName}>BharatPath</Text>
            </View>

            {/* Main Result Content: Reveals score when toggled */}
            <View style={styles.cardContent}>
              {showExact ? (
                <View style={styles.exactScoreContainer}>
                  <View style={styles.scoreRow}>
                    <Text
                      style={styles.bigScoreText}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.7}
                    >
                      {score ?? '-'}
                    </Text>
                    <Text style={styles.maxScoreText} numberOfLines={1}>/ {maxScore}</Text>
                  </View>
                  <Text
                    style={styles.revealedBandText}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {bandName || 'Not scored yet'}
                  </Text>
                </View>
              ) : (
                <Text
                  style={styles.hugeBandText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.65}
                >
                  {bandName || 'Not scored yet'}
                </Text>
              )}

              {/* Candidate Info Footer */}
              <View style={styles.metaContainer}>
                {detailsLine ? (
                  <Text
                    style={styles.candidateDetails}
                    numberOfLines={2}
                    ellipsizeMode="tail"
                  >
                    {detailsLine}
                  </Text>
                ) : null}
                <Text style={styles.dateMeta} numberOfLines={1}>
                  SCORED FROM MY RESUME · {formattedDate}
                </Text>
              </View>
            </View>
          </View>

          {/* Show Exact Number Toggle Section */}
          <Pressable
            style={styles.toggleCard}
            onPress={() => setShowExact((prev) => !prev)}
          >
            <View style={styles.toggleTextContainer}>
              <Text style={styles.toggleTitle}>Show my exact number</Text>
              <Text style={styles.toggleSubtitle}>
                Off by default - only your band is shared
              </Text>
            </View>
            <Switch
              value={showExact}
              onValueChange={setShowExact}
              trackColor={{ false: '#E2DDEB', true: '#5F4DB2' }}
              thumbColor="#FFFFFF"
              ios_backgroundColor="#E2DDEB"
            />
          </Pressable>

          {/* Bottom Actions: Save & Share */}
          <View style={styles.actionButtonsRow}>
            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={onSave}
              accessibilityRole="button"
            >
              <DownloadSimple size={18} color={Colors.navy} weight="bold" />
              <Text style={styles.saveButtonText}>Save</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.shareButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={onShare}
              accessibilityRole="button"
            >
              <ShareNetwork size={18} color="#FFFFFF" weight="bold" />
              <Text style={styles.shareButtonText}>Share</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFCF7', // Canvas background
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg, // 20px
    paddingTop: Spacing.md, // 12px
    paddingBottom: Spacing.xxl, // 40px
    gap: Spacing.lg, // 20px
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md, // 12px
    paddingBottom: 4,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  navTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: Colors.navy, // #0A1931
    flex: 1,
  },
  shareCard: {
    backgroundColor: '#5F4DB2', // Updated to match HTML
    borderRadius: 26,
    padding: 24,
    aspectRatio: 4 / 5,
    minHeight: 380,
    justifyContent: 'space-between',
    shadowColor: 'rgba(10, 25, 49, 0.4)',
    shadowOffset: { width: 0, height: 26 },
    shadowOpacity: 1,
    shadowRadius: 54,
    elevation: 8,
    overflow: 'hidden',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  logoMark: {
    width: 22,
    height: 22,
  },
  brandName: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 15,
    lineHeight: 18,
    letterSpacing: -0.2,
    color: '#FFFFFF',
  },
  cardContent: {
    gap: 12,
  },
  hugeBandText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 42,
    lineHeight: 46,
    letterSpacing: -1,
    color: '#FFFFFF',
  },
  exactScoreContainer: {
    gap: 4,
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
  },
  bigScoreText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 74,
    lineHeight: 74,
    letterSpacing: -2.5,
    color: '#FFFFFF',
  },
  maxScoreText: {
    fontFamily: 'SpaceMono-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: 'rgba(255, 255, 255, 0.65)',
    paddingBottom: 8,
  },
  revealedBandText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.5,
    color: 'rgba(255, 255, 255, 0.95)',
  },
  metaContainer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.2)',
    paddingTop: 12,
    marginTop: 4,
    gap: 4,
  },
  candidateDetails: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    lineHeight: 18,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  dateMeta: {
    fontFamily: 'SpaceMono-Regular',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.6,
    color: 'rgba(255, 255, 255, 0.62)',
  },
  toggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
    borderRadius: 16,
    padding: 16,
    gap: 16,
  },
  toggleTextContainer: {
    flex: 1,
    gap: 2,
  },
  toggleTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy, // #0A1931
  },
  toggleSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md, // 12px
    marginTop: 'auto',
    paddingTop: Spacing.sm,
  },
  saveButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
    paddingVertical: 16,
    borderRadius: Radii.pill, // 999
  },
  saveButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: Colors.navy, // #0A1931
  },
  shareButton: {
    flex: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#5F4DB2',
    paddingVertical: 18,
    borderRadius: Radii.pill, // 999
  },
  shareButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
  },
});
