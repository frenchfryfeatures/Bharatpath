/**
 * Hub layout.
 * ~72px top spacing, full-width sections with 20px internal horizontal padding,
 * and space reserved for the floating bottom navigation.
 */
import { ReactNode } from 'react';
import { ScrollView, View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Colors, Layout, Spacing } from '@/theme/tokens';

interface HubScreenProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scrollable?: boolean;
}

export function HubScreen({ children, style, scrollable = true }: HubScreenProps) {
  const content = (
    <View style={[styles.inner, style]}>
      {children}
    </View>
  );

  if (scrollable) {
    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={true}
      >
        {content}
      </ScrollView>
    );
  }

  return <View style={styles.container}>{content}</View>;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.offWhite,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 100, // space for floating bottom nav
  },
  inner: {
    paddingTop: Layout.hubTopSpacing,
    maxWidth: Layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
