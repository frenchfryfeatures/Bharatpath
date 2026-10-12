/**
 * BottomTabBar - Floating navigation matching BharatPath Design Specification.
 * Features 4 core product tabs: Home, Jobs, Board, You.
 * Active tab has full rounded highlight container (#F1EAF7) with filled icon.
 */
import { Pressable, View, Text, StyleSheet, Platform, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { House, Briefcase, ListChecks, User } from 'phosphor-react-native';
import { Colors, Radii, Spacing, Layout, Shadows } from '@/theme/tokens';
import type { IconWeight } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type TabName = 'home' | 'jobs' | 'board' | 'you' | 'preview';

interface TabConfig {
  name: 'home' | 'jobs' | 'board' | 'you';
  label: string;
  icon: typeof House;
  href: string;
}

const tabs: TabConfig[] = [
  { name: 'home', label: 'Home', icon: House, href: '/home' },
  { name: 'jobs', label: 'Jobs', icon: Briefcase, href: '/jobs' },
  { name: 'board', label: 'Board', icon: ListChecks, href: '/board' },
  { name: 'you', label: 'You', icon: User, href: '/you' },
];

interface BottomTabBarProps {
  activeTab: TabName;
  onTabPress: (tab: TabName, href: string) => void;
  style?: ViewStyle;
}

export function BottomTabBar({ activeTab, onTabPress, style }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[styles.wrapper, { bottom: Math.max(insets.bottom + 8, 12) }, style]}
      pointerEvents="box-none"
    >
      <View style={styles.barContainer}>
        {Platform.OS === 'web' ? (
          <View style={styles.bar}>
            {tabs.map((tab) => (
              <TabItem
                key={tab.name}
                tab={tab}
                isActive={activeTab === tab.name || (activeTab === 'preview' && tab.name === 'home')}
                onPress={onTabPress}
              />
            ))}
          </View>
        ) : (
          <BlurView intensity={70} tint="light" style={styles.blurBar}>
            {tabs.map((tab) => (
              <TabItem
                key={tab.name}
                tab={tab}
                isActive={activeTab === tab.name || (activeTab === 'preview' && tab.name === 'home')}
                onPress={onTabPress}
              />
            ))}
          </BlurView>
        )}
      </View>
    </View>
  );
}

interface TabItemProps {
  tab: TabConfig;
  isActive: boolean;
  onPress: (tab: TabName, href: string) => void;
}

function TabItem({ tab, isActive, onPress }: TabItemProps) {
  const Icon = tab.icon;
  const iconColor = isActive ? Colors.navy : Colors.text.muted;
  const weight: IconWeight = isActive ? 'fill' : 'bold';

  return (
    <Pressable
      onPress={() => onPress(tab.name, tab.href)}
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: isActive }}
      style={({ pressed }) => [
        styles.tab,
        isActive && styles.tabActive,
        pressed && styles.tabPressed,
      ]}
    >
      <Icon size={20} color={iconColor} weight={weight} />
      <Text style={[styles.label, isActive && styles.labelActive]}>
        {tab.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 99,
  },
  barContainer: {
    width: '100%',
    maxWidth: Layout.maxContentWidth - 32,
    ...Shadows.bottomNav,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: 1,
    borderColor: '#E7E0D4',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 6,
    gap: 4,
  },
  blurBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 6,
    gap: 4,
  },
  tab: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 4,
    gap: 4,
    backgroundColor: 'transparent',
  },
  tabActive: {
    backgroundColor: '#F1EAF7', // Active lavender container from UI
  },
  tabPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
  },
  label: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 0.1,
    color: '#5F6B80',
  },
  labelActive: {
    fontFamily: 'GeneralSans-Bold',
    color: Colors.navy, // #0A1931
  },
});
