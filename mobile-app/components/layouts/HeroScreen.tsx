/**
 * Hero layout.
 * Deep navy header with ~62px top padding, 20px horizontal padding, 26px bottom padding.
 * A cream content sheet overlaps the hero by ~16px with 28px top corner radius.
 */
import { ReactNode } from 'react';
import { ScrollView, View, StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Colors, Layout, Radii, Spacing } from '@/theme/tokens';

interface HeroScreenProps {
  heroContent: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scrollable?: boolean;
}

export function HeroScreen({ heroContent, children, style, scrollable = true }: HeroScreenProps) {
  const sheet = (
    <View style={[styles.sheet, style]}>
      {children}
    </View>
  );

  if (scrollable) {
    return (
      <View style={styles.container}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          bounces={true}
        >
          <View style={styles.hero}>
            {heroContent}
          </View>
          {sheet}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        {heroContent}
      </View>
      {sheet}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.purple,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 100,
  },
  hero: {
    paddingTop: Layout.heroTopPadding,
    paddingHorizontal: Layout.heroHorizontalPadding,
    paddingBottom: Layout.heroBottomPadding + Layout.sheetOverlap,
    maxWidth: Layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  sheet: {
    backgroundColor: Colors.offWhite,
    borderTopLeftRadius: Radii.sheet,
    borderTopRightRadius: Radii.sheet,
    marginTop: -Layout.sheetOverlap,
    paddingHorizontal: Layout.screenPaddingHorizontal,
    paddingTop: Spacing.xl,
    paddingBottom: Layout.screenPaddingBottom,
    minHeight: 200,
    maxWidth: Layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
    flex: 1,
  },
});
