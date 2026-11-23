/**
 * The one placeholder a screen shows while its first data loads
 * (2026-11-23): a title line and a few blocks on the app's background.
 * Deliberately minimal and static -- it only has to stop a blank or a lone
 * spinner from appearing between screens.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '@/theme/tokens';

export function ScreenSkeleton({ blocks = 3 }: { blocks?: number }) {
  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']} accessibilityLabel="Loading" accessibilityState={{ busy: true }}>
      <View style={styles.title} />
      {Array.from({ length: blocks }, (_, index) => (
        <View key={index} style={[styles.block, index === 0 && styles.blockTall]} />
      ))}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.offWhite, paddingHorizontal: 20, paddingTop: 20, gap: 14 },
  title: { width: '55%', height: 22, borderRadius: 8, backgroundColor: '#EDE8E1' },
  block: { height: 88, borderRadius: 16, backgroundColor: '#F3EFE9' },
  blockTall: { height: 160 },
});
