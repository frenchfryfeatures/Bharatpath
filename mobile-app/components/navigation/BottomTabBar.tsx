/**
 * BottomTabBar - Floating navigation matching BharatPath Design Specification.
 * Features 4 core product tabs: Home, Jobs, Board, You.
 * Active tab has full rounded highlight container (#F1EAF7) with filled icon.
 */
import { useState } from 'react';
import { Pressable, View, Text, StyleSheet, Platform, ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { House, Briefcase, ListChecks, User, Sparkle } from 'phosphor-react-native';
import { Colors, Radii, Spacing, Layout, Shadows } from '@/theme/tokens';
import type { IconWeight } from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CareerAssistantModal } from '@/components/assistant/CareerAssistantModal';

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
  onAssistantPress?: () => void;
  style?: ViewStyle;
}

export function BottomTabBar({ activeTab, onTabPress, onAssistantPress, style }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const [assistantVisible, setAssistantVisible] = useState(false);

  const handleOpenAssistant = () => {
    if (onAssistantPress) {
      onAssistantPress();
    } else {
      setAssistantVisible(true);
    }
  };

  const renderTabContent = () => (
    <>
      <TabItem
        tab={tabs[0]}
        isActive={activeTab === 'home' || (activeTab === 'preview')}
        onPress={onTabPress}
      />
      <TabItem
        tab={tabs[1]}
        isActive={activeTab === 'jobs'}
        onPress={onTabPress}
      />

      {/* Center AI Chatbot Button */}
      <View style={styles.assistantCenterWrapper}>
        <Pressable
          onPress={handleOpenAssistant}
          accessibilityRole="button"
          accessibilityLabel="Open AI Career Assistant"
          testID="career-assistant-center-tab-btn"
          style={({ pressed }) => [
            styles.assistantCenterBtn,
            pressed && styles.assistantCenterBtnPressed,
          ]}
        >
          <Sparkle size={24} color="#FFFFFF" weight="fill" />
        </Pressable>
      </View>

      <TabItem
        tab={tabs[2]}
        isActive={activeTab === 'board'}
        onPress={onTabPress}
      />
      <TabItem
        tab={tabs[3]}
        isActive={activeTab === 'you'}
        onPress={onTabPress}
      />
    </>
  );

  return (
    <>
      <View
        style={[styles.wrapper, { bottom: Math.max(insets.bottom + 8, 12) }, style]}
        pointerEvents="box-none"
      >
        <View style={styles.barContainer}>
          {Platform.OS === 'web' ? (
            <View style={styles.bar}>
              {renderTabContent()}
            </View>
          ) : (
            <BlurView intensity={70} tint="light" style={styles.blurBar}>
              {renderTabContent()}
            </BlurView>
          )}
        </View>
      </View>

      <CareerAssistantModal
        visible={assistantVisible}
        onClose={() => setAssistantVisible(false)}
      />
    </>
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
  assistantCenterWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
  },
  assistantCenterBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  assistantCenterBtnPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.9,
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
