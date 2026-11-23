/**
 * Add-ons (2026-11-23): every way to earn a reward, as tiles. Opened from the
 * profile's Add-ons card. Add a tile by adding an entry to `ADD_ONS`.
 *
 * Wording matters here: a skill course and a mock interview add to the
 * Bharatpath Score; daily-streak points are a separate balance that never
 * reaches the score (docs/streaks.md), so that tile must not say otherwise.
 * No tile states a number of points: the score is never explained (R11).
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, BookOpen, CaretRight, Fire, Microphone, type Icon } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';

export interface AddOnTile {
  key: string;
  title: string;
  description: string;
  reward: string;
  route: string;
  Icon: Icon;
  tint: string;
  iconColor: string;
}

export const ADD_ONS: AddOnTile[] = [
  {
    key: 'courses',
    title: 'Skill courses',
    description: 'Short certified courses you can finish at your own pace.',
    reward: 'Adds to your Bharatpath Score',
    route: '/courses',
    Icon: BookOpen,
    tint: '#E8EEF9',
    iconColor: '#2F5DA8',
  },
  {
    key: 'mock-interview',
    title: 'Mock interview',
    description: 'Practise answering interview questions and get feedback.',
    reward: 'Adds to your Bharatpath Score',
    route: '/mock-interview',
    Icon: Microphone,
    tint: '#FDEBDD',
    iconColor: '#B4561C',
  },
  {
    key: 'streak',
    title: 'Daily streak',
    description: 'Log in every day to build your streak.',
    reward: 'Earns streak points',
    route: '/streak',
    Icon: Fire,
    tint: '#FFF1E0',
    iconColor: '#FF6B00',
  },
];

export function AddOnsScreen({ onBack, onOpen }: { onBack: () => void; onOpen: (route: string) => void }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <StatusBar style="dark" animated />
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={onBack} accessibilityRole="button" accessibilityLabel="Back">
          <ArrowLeft size={18} color={Colors.navy} weight="bold" />
        </Pressable>
        <View style={styles.headerTextGroup}>
          <Text style={styles.headerTitle} accessibilityRole="header">Add-ons</Text>
          <Text style={styles.headerSubtitle} numberOfLines={2}>Ways to earn rewards on BharatPath</Text>
        </View>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {ADD_ONS.map(({ key, title, description, reward, route, Icon, tint, iconColor }) => (
          <Pressable
            key={key}
            onPress={() => onOpen(route)}
            accessibilityRole="button"
            accessibilityLabel={`${title}. ${reward}`}
            style={({ pressed }) => [styles.tile, pressed && styles.tilePressed]}
          >
            <View style={[styles.iconBadge, { backgroundColor: tint }]}>
              <Icon size={24} color={iconColor} weight="duotone" />
            </View>
            <View style={styles.tileText}>
              <Text style={styles.tileTitle}>{title}</Text>
              <Text style={styles.tileDescription}>{description}</Text>
              <View style={styles.rewardPill}>
                <Text style={styles.rewardText}>{reward}</Text>
              </View>
            </View>
            <CaretRight size={16} color="#5F6B80" weight="bold" />
          </Pressable>
        ))}
      </ScrollView>
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
  headerSubtitle: { fontFamily: 'GeneralSans-Regular', fontSize: 12, color: Colors.text.muted, marginTop: 2 },
  content: { padding: Spacing.base, paddingBottom: 40, gap: Spacing.md },
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: Radii.card,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    padding: Spacing.base,
  },
  tilePressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  iconBadge: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tileText: { flex: 1, minWidth: 0, gap: 4 },
  tileTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 16, lineHeight: 22, color: Colors.navy },
  tileDescription: { fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 19, color: '#5F6B80' },
  rewardPill: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: '#F1EAF7',
  },
  rewardText: { fontFamily: 'GeneralSans-Semibold', fontSize: 12, color: '#4A3E8F' },
});
