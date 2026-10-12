import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useBharatPathFonts } from '@/theme/fonts';
import { injectWebFonts } from '@/theme/webFonts';
import { AuthProvider } from '@/context/AuthContext';
import { AppProvider } from '@/context/AppContext';
import { configureNotificationPresentation } from '@/services/notifications/device';
import { AppAlertRoot } from '@/components/feedback/AppAlert';
import { PushNotificationBridge } from '@/components/PushNotificationBridge';

export default function RootLayout() {
  const { fontsLoaded, fontError } = useBharatPathFonts();

  useEffect(() => {
    injectWebFonts();
    // Foreground notifications must explicitly opt into a banner/list entry.
    configureNotificationPresentation();
  }, []);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <AuthProvider>
      <PushNotificationBridge />
      <AppProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="home" />
          <Stack.Screen name="attribute-check" />
          <Stack.Screen name="attribute-quiz" />
          <Stack.Screen name="attribute-report" />
          <Stack.Screen name="mock-interview" />
          <Stack.Screen name="device-check" />
          <Stack.Screen name="interview-session" />
          <Stack.Screen name="interview-sessions" />
          <Stack.Screen name="interview-report" />
          <Stack.Screen name="jobs" />
          <Stack.Screen name="job-detail" />
          <Stack.Screen name="application-sent" />
          <Stack.Screen name="board" />
          <Stack.Screen name="application-detail" />
          <Stack.Screen name="you" />
          <Stack.Screen name="resume-details" />
          <Stack.Screen name="who-has-seen-me" />
          <Stack.Screen name="notifications" />
          <Stack.Screen name="streak" />
          <Stack.Screen name="courses" />
          <Stack.Screen name="course-detail" />
          <Stack.Screen name="subscription" />
          <Stack.Screen name="share-result" />
          <Stack.Screen name="+not-found" />
        </Stack>
        <AppAlertRoot />
        <StatusBar style="dark" />
      </AppProvider>
    </AuthProvider>
  );
}
