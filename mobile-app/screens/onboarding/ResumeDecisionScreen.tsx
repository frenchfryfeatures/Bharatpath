import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Sparkle, UploadSimple, ArrowRight, ArrowLeft } from 'phosphor-react-native';

export function ResumeDecisionScreen({
  onBuildResume,
  onUploadCv,
  onBack,
}: {
  onBuildResume: () => void;
  onUploadCv: () => void;
  onBack?: () => void;
}) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {onBack && (
          <Pressable onPress={onBack} style={styles.backButton} accessibilityLabel="Back">
            <ArrowLeft size={22} color="#0A1931" />
          </Pressable>
        )}
        <Text style={styles.headerStep}>Step 5 of 5</Text>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.badge}>
          <Sparkle size={14} color="#5F4DB2" weight="fill" />
          <Text style={styles.badgeText}>Resume Generation</Text>
        </View>

        <Text style={styles.title}>How would you like to provide your resume?</Text>
        <Text style={styles.subtitle}>
          You can generate a formatted, ATS-compliant resume from your profile answers, or upload an existing file.
        </Text>

        <View style={styles.cards}>
          {/* Option 1: Build Resume */}
          <Pressable
            onPress={onBuildResume}
            style={({ pressed }) => [styles.card, styles.cardFeatured, pressed && styles.cardPressed]}
          >
            <View style={styles.cardHeader}>
              <View style={[styles.iconBox, styles.iconBoxFeatured]}>
                <Sparkle size={24} color="#FFFFFF" weight="fill" />
              </View>
              <View style={styles.featuredBadge}>
                <Text style={styles.featuredBadgeText}>Instant & Recommended</Text>
              </View>
            </View>

            <Text style={styles.cardTitle}>Build my resume</Text>
            <Text style={styles.cardDescription}>
              Generate a professional resume instantly using your profile details. Choose from 4 ATS-friendly templates, add projects, and preview or download it as PDF.
            </Text>

            <View style={styles.cardFooter}>
              <Text style={styles.actionTextFeatured}>Generate & customize</Text>
              <ArrowRight size={18} color="#5F4DB2" weight="bold" />
            </View>
          </Pressable>

          {/* Option 2: Upload existing CV */}
          <Pressable
            onPress={onUploadCv}
            style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
          >
            <View style={styles.cardHeader}>
              <View style={styles.iconBox}>
                <UploadSimple size={24} color="#0A1931" weight="bold" />
              </View>
            </View>

            <Text style={styles.cardTitle}>Upload existing CV</Text>
            <Text style={styles.cardDescription}>
              Already have a resume ready? Upload your PDF or DOCX file directly to continue.
            </Text>

            <View style={styles.cardFooter}>
              <Text style={styles.actionText}>Upload document</Text>
              <ArrowRight size={18} color="#0A1931" weight="bold" />
            </View>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FAF8F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  backButton: {
    padding: 6,
    marginRight: 10,
  },
  headerStep: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5F4DB2',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  content: {
    padding: 24,
    paddingTop: 10,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#EDE8F8',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    gap: 6,
    marginBottom: 14,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  title: {
    fontSize: 26,
    fontWeight: '800',
    color: '#0A1931',
    lineHeight: 32,
    letterSpacing: -0.4,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5F6B80',
    marginBottom: 28,
  },
  cards: {
    gap: 16,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E7DFD5',
    padding: 20,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  cardFeatured: {
    borderColor: '#B9AEE2',
    backgroundColor: '#FDFBFF',
    shadowColor: '#5F4DB2',
    shadowOpacity: 0.08,
    shadowRadius: 14,
  },
  cardPressed: {
    transform: [{ scale: 0.99 }],
    opacity: 0.95,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#F1EAF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxFeatured: {
    backgroundColor: '#5F4DB2',
  },
  featuredBadge: {
    backgroundColor: '#EDE8F8',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  featuredBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0A1931',
    marginBottom: 8,
    letterSpacing: -0.2,
  },
  cardDescription: {
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
    marginBottom: 18,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0EBE5',
  },
  actionTextFeatured: {
    fontSize: 14,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  actionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0A1931',
  },
});
