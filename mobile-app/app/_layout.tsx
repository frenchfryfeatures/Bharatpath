import { useEffect } from 'react';
import { Stack, usePathname, useGlobalSearchParams } from 'expo-router';
import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { View } from 'react-native';
import { Colors } from '@/theme/tokens';
import { StatusBar } from 'expo-status-bar';
import { useBharatPathFonts } from '@/theme/fonts';
import { injectWebFonts } from '@/theme/webFonts';
import { AuthProvider } from '@/context/AuthContext';
import { AppProvider } from '@/context/AppContext';
import { configureNotificationPresentation } from '@/services/notifications/device';
import { AppAlertRoot } from '@/components/feedback/AppAlert';
import { AppToastRoot } from '@/components/feedback/AppToast';
import { PushNotificationBridge } from '@/components/PushNotificationBridge';
import { installGlobalErrorLogger, logger } from '@/utils/logger';
import { getBaseUrl } from '@/services/api/client';
import { SystemNavigationFrame } from '@/components/layout/SystemNavigationFrame';

installGlobalErrorLogger();

// Between screens, before the next one paints, the navigator itself shows
// (2026-11-23). It used React Navigation's default near-white background,
// which flashed white on every transition; it now shows the app's own cream,
// so a transition goes from one screen straight to the next.
const SCREEN_BACKGROUND = { flex: 1, backgroundColor: Colors.offWhite } as const;
const APP_THEME = {
  ...DefaultTheme,
  colors: { ...DefaultTheme.colors, background: Colors.offWhite, card: Colors.offWhite },
};

// Bottom-tab screens switch with a short fade, not the stack's slide-in
// (2026-11-23): a tab change should feel like a tab change.
const TAB_SCREEN = { animation: 'fade', animationDuration: 150 } as const;

export default function RootLayout() {
  const { fontsLoaded, fontError } = useBharatPathFonts();
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams();

  useEffect(() => {
    logger.step('AppBoot', 'RootLayout mounted', {
      resolvedApiBaseUrl: getBaseUrl(),
      cognitoRegion: process.env.EXPO_PUBLIC_COGNITO_REGION || 'ap-south-1',
      cognitoPoolId: process.env.EXPO_PUBLIC_COGNITO_USER_POOL_ID || 'ap-south-1_W3LPdPnh4',
      devTokenMode: process.env.EXPO_PUBLIC_AUTH_USE_DEV_TOKEN === 'true',
    });
    injectWebFonts();
    // Foreground notifications must explicitly opt into a banner/list entry.
    configureNotificationPresentation();
  }, []);

  useEffect(() => {
    if (fontError) {
      logger.error('AppBoot', 'Font loading failed', fontError);
    }
  }, [fontError]);

  useEffect(() => {
    if (pathname) {
      logger.step('Router', `Navigated to route: ${pathname}`, Object.keys(searchParams).length ? searchParams : undefined);
    }
  }, [pathname, JSON.stringify(searchParams)]);

  if (!fontsLoaded && !fontError) {
    return <View style={SCREEN_BACKGROUND} />;
  }

  return (
    <AuthProvider>
      <PushNotificationBridge />
      <AppProvider>
        <SystemNavigationFrame manageNativeBar>
          <ThemeProvider value={APP_THEME}>
          <Stack screenOptions={{ headerShown: false, navigationBarHidden: false, autoHideHomeIndicator: false, contentStyle: SCREEN_BACKGROUND }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="home" options={TAB_SCREEN} />
            <Stack.Screen name="attribute-check" />
            <Stack.Screen name="attribute-quiz" />
            <Stack.Screen name="attribute-report" />
            <Stack.Screen name="mock-interview" />
            <Stack.Screen name="device-check" />
            <Stack.Screen name="interview-session" />
            <Stack.Screen name="interview-sessions" />
            <Stack.Screen name="interview-report" />
            <Stack.Screen name="jobs" options={TAB_SCREEN} />
            <Stack.Screen name="job-detail" />
            <Stack.Screen name="application-sent" />
            <Stack.Screen name="board" options={TAB_SCREEN} />
            <Stack.Screen name="application-detail" />
            <Stack.Screen name="you" options={TAB_SCREEN} />
            <Stack.Screen name="resume-details" />
            <Stack.Screen name="who-has-seen-me" />
            <Stack.Screen name="privacy-policy" />
            <Stack.Screen name="notifications" />
            <Stack.Screen name="streak" />
            <Stack.Screen name="job-preferences" />
            <Stack.Screen name="addons" />
            <Stack.Screen name="courses" />
            <Stack.Screen name="course-detail" />
            <Stack.Screen name="subscription" />
            <Stack.Screen name="share-result" />
            <Stack.Screen name="+not-found" />
          </Stack>
          </ThemeProvider>
          <AppAlertRoot />
          <AppToastRoot />
          <StatusBar style="dark" />
        </SystemNavigationFrame>
      </AppProvider>
    </AuthProvider>
  );
}
