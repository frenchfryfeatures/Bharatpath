/**
 * Job preferences as its own screen (2026-11-23), opened from the profile's
 * "Job preferences" row. The form itself is `JobPreferencesPanel`.
 */
import React from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft } from 'phosphor-react-native';
import { Colors, Spacing } from '@/theme/tokens';
import { JobPreferencesPanel } from './JobPreferencesPanel';

export function JobPreferencesScreen({
  onBack,
  onOpenProfile,
}: {
  onBack: () => void;
  onOpenProfile: () => void;
}) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" animated />
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft size={18} color={Colors.navy} weight="bold" />
        </Pressable>
        <View style={styles.headerTextGroup}>
          <Text style={styles.headerTitle} accessibilityRole="header">Job preferences</Text>
        </View>
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <JobPreferencesPanel onOpenProfile={onOpenProfile} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surface.tint,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  headerTextGroup: { flex: 1 },
  headerTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 18, color: Colors.navy },
  content: { paddingTop: Spacing.base, paddingBottom: 40 },
});
