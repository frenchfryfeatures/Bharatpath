import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { AppState, Platform, StyleSheet, View } from 'react-native';
import { SafeAreaFrameContext, SafeAreaInsetsContext, useSafeAreaFrame, useSafeAreaInsets, type Metrics } from 'react-native-safe-area-context';
import * as NavigationBar from 'expo-navigation-bar';
import * as SystemUI from 'expo-system-ui';
import { systemNavigationLayout, type SystemBarTone } from '@/utils/systemNavigation';
import { logger } from '@/utils/logger';

const WindowMetricsContext = createContext<Metrics | null>(null);
export const useSystemWindowMetrics = () => useContext(WindowMetricsContext);

/** Reserve the system area once. Descendants receive an already-consumed
 * bottom inset so their SafeAreaViews and pinned footers do not double-pad.
 * Native modals use their own provider/frame because they have another window.
 */
export function SystemNavigationFrame({ children, tone = 'light', manageNativeBar = false, transparent = false }: {
  children: React.ReactNode; tone?: SystemBarTone; manageNativeBar?: boolean; transparent?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const frame = useSafeAreaFrame();
  const layout = systemNavigationLayout(frame.height, Platform.OS === 'web' ? 0 : insets.bottom, tone);
  const metrics = useMemo(() => ({ insets, frame }), [insets, frame]);
  const contentInsets = useMemo(() => ({ ...insets, bottom: 0 }), [insets]);
  const contentFrame = useMemo(() => ({ ...frame, height: layout.contentHeight }), [frame, layout.contentHeight]);

  useEffect(() => {
    if (!manageNativeBar || Platform.OS === 'web') return;
    const restore = () => {
      void SystemUI.setBackgroundColorAsync(layout.backgroundColor).catch(error => logger.warn('SystemNavigation', 'Could not set window background', error));
      if (Platform.OS === 'android') {
        void NavigationBar.setButtonStyleAsync(layout.buttonStyle).catch(error => logger.warn('SystemNavigation', 'Could not set navigation contrast', error));
        void NavigationBar.setVisibilityAsync('visible').catch(error => logger.warn('SystemNavigation', 'Could not restore system navigation', error));
      }
    };
    restore();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') restore(); });
    const visibility = Platform.OS === 'android' ? NavigationBar.addVisibilityListener(event => {
      if (event.visibility === 'hidden') restore();
    }) : null;
    return () => { subscription.remove(); visibility?.remove(); };
  }, [layout.backgroundColor, layout.buttonStyle, manageNativeBar]);

  return <WindowMetricsContext.Provider value={metrics}>
    <View style={[styles.window, { backgroundColor: transparent ? 'transparent' : layout.backgroundColor }]}>
      <View style={styles.content} collapsable={false}>
        <SafeAreaFrameContext.Provider value={contentFrame}>
          <SafeAreaInsetsContext.Provider value={contentInsets}>{children}</SafeAreaInsetsContext.Provider>
        </SafeAreaFrameContext.Provider>
      </View>
      <View testID="system-navigation-area" pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ height: layout.bottom, backgroundColor: layout.backgroundColor }}/>
    </View>
  </WindowMetricsContext.Provider>;
}
const styles = StyleSheet.create({ window: { flex: 1 }, content: { flex: 1, overflow: 'hidden' } });
