import React from 'react';
import { View, Text, StyleSheet, Image, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Colors, Radii, Spacing } from '@/theme/tokens';

interface HowItWorksScreenProps {
  onGotIt?: () => void;
  onBack?: () => void;
}

export function HowItWorksScreen({ onGotIt, onBack }: HowItWorksScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" animated />
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Step Progress Header */}
          <View style={styles.headerProgressSection}>
            <Text style={styles.stepEyebrow}>STEP 2 OF 3</Text>
            <View style={styles.progressSegmentsRow}>
              <View style={[styles.progressSegment, styles.segmentActive]} />
              <View style={[styles.progressSegment, styles.segmentActive]} />
              <View style={[styles.progressSegment, styles.segmentInactive]} />
            </View>
          </View>

          {/* Screen Title & Subtitle */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>Three steps, that's all</Text>
            <Text style={styles.subtitle}>
              Give us your resume, check what we read, then see your Bharatpath Score.
            </Text>
          </View>

          {/* Cards Section */}
          <View style={styles.cardsList}>
            {/* Card 1 */}
            <View style={styles.stepCard}>
              <View style={styles.cardInfo}>
                <View style={styles.badgeRow}>
                  <View style={styles.numberBadge}>
                    <Text style={styles.badgeText}>1</Text>
                  </View>
                  <Text style={styles.stepTitleLabel}>STEP ONE</Text>
                </View>
                <Text style={styles.cardTitle}>Give us your resume</Text>
                <Text style={styles.cardBody}>
                  A file, pasted text, or fill a short form if you don't have one yet.
                </Text>
              </View>
              <View style={styles.imageContainer92}>
                <Image
                  source={require('../../assets/icons/how-1.png')}
                  style={[styles.cardImage, { transform: [{ scale: 2.05 }] }]}
                  resizeMode="contain"
                />
              </View>
            </View>

            {/* Card 2 */}
            <View style={styles.stepCard}>
              <View style={styles.cardInfo}>
                <View style={styles.badgeRow}>
                  <View style={styles.numberBadge}>
                    <Text style={styles.badgeText}>2</Text>
                  </View>
                  <Text style={styles.stepTitleLabel}>STEP TWO</Text>
                </View>
                <Text style={styles.cardTitle}>Check what we read</Text>
                <Text style={styles.cardBody}>
                  You correct anything wrong before it counts. Nothing is scored behind your back.
                </Text>
              </View>
              <View style={styles.imageContainer92}>
                <Image
                  source={require('../../assets/icons/how-2.png')}
                  style={[styles.cardImage, { transform: [{ scale: 1.78 }] }]}
                  resizeMode="contain"
                />
              </View>
            </View>

            {/* Card 3 */}
            <View style={styles.stepCard}>
              <View style={styles.cardInfo}>
                <View style={styles.badgeRow}>
                  <View style={styles.numberBadge}>
                    <Text style={styles.badgeText}>3</Text>
                  </View>
                  <Text style={styles.stepTitleLabel}>STEP THREE</Text>
                </View>
                <Text style={styles.cardTitle}>Get your Bharatpath Score and gaps</Text>
                <Text style={styles.cardBody}>
                  Five categories, each explained, with the fixes worth the most points.
                </Text>
              </View>
              <View style={styles.imageContainer84}>
                <Image
                  source={require('../../assets/icons/how-3.png')}
                  style={[styles.cardImage, { transform: [{ scale: 1.34 }] }]}
                  resizeMode="contain"
                />
              </View>
            </View>
          </View>
        </ScrollView>

        {/* Bottom Actions Row */}
        <View style={styles.actionsRow}>
          <Pressable
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.gotItButton,
              pressed && styles.gotItPressed,
            ]}
            onPress={onGotIt}
            accessibilityRole="button"
            accessibilityLabel="Got it"
          >
            <Text style={styles.gotItButtonText}>Got it</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const ACCENT_PURPLE = '#5F4DB2';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFCF7',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFCF7',
    paddingHorizontal: 20,
  },
  scrollContent: {
    paddingTop: 24,
    paddingBottom: 20,
    gap: 24,
  },
  headerProgressSection: {
    gap: 8,
  },
  stepEyebrow: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 1.32, // 0.12em tracking
    color: '#5F6B80',
  },
  progressSegmentsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: Radii.pill, // 999
  },
  segmentActive: {
    backgroundColor: ACCENT_PURPLE, // #5F4DB2 matching BharatPath R_26Aug2026.dc.html
  },
  segmentInactive: {
    backgroundColor: '#E7E0D4',
  },
  titleSection: {
    gap: 0,
    marginTop: 8,
  },
  title: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.75, // -0.025em tracking
    color: '#0A1931',
    margin: 0,
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#3A4761',
    marginTop: 4,
  },
  cardsList: {
    gap: 12,
  },
  stepCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    paddingTop: 18,
    paddingBottom: 18,
    paddingLeft: 20,
    paddingRight: 18,
    gap: 14,
  },
  cardInfo: {
    flex: 1,
    gap: 6,
    minWidth: 0,
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  numberBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ACCENT_PURPLE, // #5F4DB2 circle badge matching R_26Aug2026 design
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 12,
    color: '#FFFCF7', // Cream white number inside badge
    textAlign: 'center',
  },
  stepTitleLabel: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 1.32, // 0.12em tracking
    color: '#566073',
  },
  cardTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 18,
    lineHeight: 23,
    letterSpacing: -0.36, // -0.02em tracking
    color: '#0A1931',
  },
  cardBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#3A4761',
  },
  imageContainer92: {
    width: 92,
    height: 92,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  imageContainer84: {
    width: 84,
    height: 84,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  },
  cardImage: {
    width: 84,
    height: 84,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
    paddingBottom: 20,
    backgroundColor: '#FFFCF7',
  },
  backButton: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
    paddingVertical: 18,
    borderRadius: Radii.pill, // 999
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  backButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#0A1931',
  },
  gotItButton: {
    flex: 2,
    backgroundColor: ACCENT_PURPLE, // #5F4DB2 vibrant accent button matching R_26Aug2026 design
    paddingVertical: 18,
    borderRadius: Radii.pill, // 999
    alignItems: 'center',
    justifyContent: 'center',
  },
  gotItPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  gotItButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
  },
});
