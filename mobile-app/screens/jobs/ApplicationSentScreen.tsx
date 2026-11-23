/**
 * BharatPath - ApplicationSentScreen
 * Exactly matches Screen 37 from BharatPath Handoff and Screenshot 5.
 * Features:
 * - Animated paper plane green badge with launch trail
 * - "Application sent" title & employer access description
 * - Application summary card (Sent: Today 4:12 pm, Closes if silent: In 30 days, You can withdraw: Any time)
 * - Actions: "See my board" (primary navy) and "Keep looking at jobs" (secondary text)
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  PaperPlaneTilt,
  Clock,
  HourglassMedium,
  ArrowUUpLeft,
} from 'phosphor-react-native';
import { Colors, Spacing } from '@/theme/tokens';

export interface ApplicationSentScreenProps {
  companyName?: string;
  jobTitle?: string;
  sentAt?: string;
  onViewApplication?: () => void;
  onSeeBoard?: () => void;
  onKeepLooking?: () => void;
}

export function ApplicationSentScreen({
  companyName = 'the employer',
  jobTitle,
  sentAt,
  onViewApplication,
  onSeeBoard,
  onKeepLooking,
}: ApplicationSentScreenProps) {
  const sentDate = sentAt ? new Date(sentAt) : null;
  const sentLabel = sentDate && !Number.isNaN(sentDate.getTime()) ? sentDate.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : 'Just now';
  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Main Body Centered Section */}
          <View style={styles.centerSection}>
            {/* Paper Plane Green Icon */}
            <View style={styles.planeBadge}>
              <PaperPlaneTilt size={32} color="#FFFFFF" weight="fill" />
            </View>

            {/* Title and Subtitle */}
            <View style={styles.titleBlock}>
              <Text style={styles.mainTitle}>Application sent</Text>
              <Text style={styles.mainSubtitle}>
                Your application to {companyName} has been sent. Track updates and next steps in your applications.
              </Text>
              {!!jobTitle && <View style={styles.roleCard}><Text style={styles.roleLabel}>APPLIED FOR</Text><Text style={styles.roleTitle}>{jobTitle}</Text><Text style={styles.mainSubtitle}>{companyName}</Text></View>}
            </View>

            {/* Summary Information Card */}
            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Clock size={18} color="#5E4DB2" weight="duotone" />
                <Text style={styles.infoLabel}>Sent</Text>
                <Text style={styles.infoValue}>{sentLabel}</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.infoRow}>
                <HourglassMedium size={18} color="#0A1931" weight="duotone" />
                <Text style={styles.infoLabel}>Next step</Text>
                <Text style={styles.infoValue}>Employer review</Text>
              </View>

              <View style={styles.divider} />

              <View style={styles.infoRow}>
                <ArrowUUpLeft size={18} color="#0A1931" weight="duotone" />
                <Text style={styles.infoLabel}>Manage application</Text>
                <Text style={styles.infoValue}>Application board</Text>
              </View>
            </View>
          </View>

          {/* Bottom Actions */}
          <View style={styles.bottomActions}>
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && styles.buttonPressed,
              ]}
              onPress={onViewApplication || onSeeBoard}
              accessibilityRole="button"
            >
              <Text style={styles.primaryBtnText}>{onViewApplication ? 'View application' : 'View my applications'}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.secondaryBtn,
                pressed && styles.buttonPressed,
              ]}
              onPress={onKeepLooking}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryBtnText}>Keep looking at jobs</Text>
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
    backgroundColor: '#FFFCF7', // Off-white brand canvas
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xl,
    justifyContent: 'space-between',
  },
  centerSection: {
    flex: 1,
    justifyContent: 'flex-start',
    paddingTop: 32,
    gap: 18,
  },
  planeBadge: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: '#1F6B45', // Forest green
    justifyContent: 'center',
    alignItems: 'center',
  },
  titleBlock: {
    gap: 4,
  },
  mainTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: Colors.navy,
  },
  mainSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#3A4761',
  },
  infoCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 4,
    marginTop: 8,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
  },
  infoLabel: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#3A4761',
  },
  infoValue: {
    flex: 1,
    textAlign: 'right',
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.navy,
  },
  divider: {
    height: 1,
    backgroundColor: '#F0EBDF',
  },
  roleCard: { marginTop: 16, padding: 18, borderWidth: 1, borderColor: '#E7E0D4', borderRadius: 16, backgroundColor: '#FFFFFF', gap: 6 },
  roleLabel: { fontFamily: 'GeneralSans-Medium', fontSize: 11, lineHeight: 16, letterSpacing: 0.8, color: '#5F6B80' },
  roleTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 18, lineHeight: 24, color: '#0A1931' },
  bottomActions: {
    gap: 8,
    marginTop: 24,
  },
  primaryBtn: {
    width: '100%',
    backgroundColor: '#5F4DB2',
    borderRadius: 999,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  secondaryBtn: {
    width: '100%',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 20,
    color: '#5F6B80',
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
});
