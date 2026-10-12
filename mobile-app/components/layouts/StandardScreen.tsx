/**
 * Standard screen layout.
 * ~72px top padding, 20px horizontal padding, 40px bottom spacing.
 * Used for most form / detail / settings screens.
 */
import { ReactNode } from 'react';
import { ScrollView, View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Colors, Layout, Spacing } from '@/theme/tokens';

interface StandardScreenProps {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scrollable?: boolean;
}

export function StandardScreen({ children, style, scrollable = true }: StandardScreenProps) {
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
  },
  inner: {
    paddingTop: Layout.screenPaddingTop,
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingBottom: Layout.screenPaddingBottom,
    maxWidth: Layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
});
