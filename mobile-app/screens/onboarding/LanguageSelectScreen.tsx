import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { CaretRight } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';

export interface LanguageOption {
  id: string;
  label: string;
  sublabel?: string;
  isDevanagari?: boolean;
}

const LANGUAGES: LanguageOption[] = [
  { id: 'en', label: 'English' },
  { id: 'hi', label: 'हिंदी', sublabel: 'Hindi', isDevanagari: true },
  { id: 'mr', label: 'मराठी', sublabel: 'Marathi', isDevanagari: true },
  { id: 'more', label: '5 more languages' },
];

interface LanguageSelectScreenProps {
  onSelectLanguage?: (langId: string) => void;
  onBack?: () => void;
}

export function LanguageSelectScreen({ onSelectLanguage }: LanguageSelectScreenProps) {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" animated />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Step Progress Header */}
        <View style={styles.headerProgressSection}>
          <Text style={styles.stepEyebrow}>STEP 1 OF 3</Text>
          <View style={styles.progressSegmentsRow}>
            <View style={[styles.progressSegment, styles.segmentActive]} />
            <View style={[styles.progressSegment, styles.segmentInactive]} />
            <View style={[styles.progressSegment, styles.segmentInactive]} />
          </View>
        </View>

        {/* Screen Title & Subtitle */}
        <View style={styles.titleSection}>
          <Text style={styles.title}>Pick your language</Text>
          <Text style={styles.subtitle}>Change it any time from your profile.</Text>
        </View>

        {/* Language Cards */}
        <View style={styles.languagesList}>
          {LANGUAGES.map((lang) => (
            <Pressable
              key={lang.id}
              style={({ pressed }) => [
                styles.languageCard,
                pressed && styles.cardPressed,
              ]}
              onPress={() => onSelectLanguage && onSelectLanguage(lang.id)}
            >
              <View style={styles.labelContainer}>
                <Text
                  style={[
                    styles.primaryLabel,
                    lang.isDevanagari && styles.devanagariLabel,
                  ]}
                >
                  {lang.label}
                </Text>
                {lang.sublabel ? (
                  <Text style={styles.subLabel}>{lang.sublabel}</Text>
                ) : null}
              </View>

              <CaretRight size={18} color="#5F6B80" weight="bold" />
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const ACCENT_PURPLE = '#5F4DB2';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFCF7',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 40,
    gap: 24,
  },
  headerProgressSection: {
    gap: 8,
  },
  stepEyebrow: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 1.32, // .12em
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
    fontFamily: 'GeneralSans-Bold',
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.75, // -.025em
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
  languagesList: {
    gap: 8,
  },
  languageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: Radii.input, // 16px
    paddingVertical: Spacing.base, // 16px
    paddingHorizontal: Spacing.lg, // 20px
  },
  cardPressed: {
    backgroundColor: '#F7F4EC',
    transform: [{ scale: 0.99 }],
  },
  labelContainer: {
    flex: 1,
    gap: 2,
  },
  primaryLabel: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 17,
    lineHeight: 24,
    color: Colors.navy, // #0A1931
  },
  devanagariLabel: {
    fontFamily: 'NotoSansDevanagari-Medium',
  },
  subLabel: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 16,
    color: '#5F6B80',
  },
});
