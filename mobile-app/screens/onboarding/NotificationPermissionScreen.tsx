import React, { useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Eye, ChatCircleText, Target } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { updatePushPreference } from '@/services/api/notifications';
import { enablePushNotifications, isExpoGo } from '@/services/notifications/device';

export interface NotificationPermissionScreenProps {
  onAllow?: () => void;
  onNotNow?: () => void;
}

export function NotificationPermissionScreen({
  onAllow,
  onNotNow,
}: NotificationPermissionScreenProps) {
  const [isRequesting, setIsRequesting] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const handleAllow = async () => {
    setIsRequesting(true);
    setPermissionError(null);
    setShowSettings(false);

    try {
      const result = await enablePushNotifications();

      if (result.status === 'unsupported') {
        // Not a failure the candidate can act on, so the preference is still
        // saved and onboarding continues.
        onAllow?.();
        return;
      }

      if (result.status === 'denied') {
        await updatePushPreference(false).catch(() => undefined);
        setShowSettings(!result.canAskAgain);
        setPermissionError(
          result.canAskAgain
            ? 'Notifications were not allowed. You can try again or choose Not now.'
            : 'Notifications are blocked in your device settings. Open settings to allow them.'
        );
        return;
      }

      onAllow?.();
    } catch (error) {
      console.warn('[Notification permission]', error);
      setPermissionError(
        'Permission was requested, but BharatPath could not save your preference. Please try again.'
      );
    } finally {
      setIsRequesting(false);
    }
  };

  const handleNotNow = async () => {
    setIsRequesting(true);
    try {
      await updatePushPreference(false);
    } catch (error) {
      // Do not trap onboarding because a preference update could not be saved.
      console.warn('[Notification preference]', error);
    } finally {
      setIsRequesting(false);
      onNotNow?.();
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header Title & Subtitle */}
          <View style={styles.headingSection}>
            <Text style={styles.title}>Can we message you?</Text>
            <Text style={styles.subtitle}>
              Only these three things. Nothing else, ever.
            </Text>
          </View>

          {/* 3 Notification Value Proposition Cards */}
          <View style={styles.cardsContainer}>
            {/* Card 1: Employer opened profile */}
            <View style={styles.card}>
              <Eye size={20} color="#5F4DB2" weight="duotone" />
              <Text style={styles.cardText}>
                An employer opened your profile
              </Text>
            </View>

            {/* Card 2: Application moved forward */}
            <View style={styles.card}>
              <ChatCircleText size={20} color={Colors.navy} weight="duotone" />
              <Text style={styles.cardText}>
                Your application moved forward
              </Text>
            </View>

            {/* Card 3: Job match */}
            <View style={styles.card}>
              <Target size={20} color={Colors.navy} weight="duotone" />
              <Text style={styles.cardText}>
                A job you nearly qualify for opened
              </Text>
            </View>
          </View>

          {/* Center 3D Bell Illustration */}
          <View style={styles.illustrationContainer}>
            <Image
              source={require('../../assets/icons/notify-bell.png')}
              style={styles.bellImage}
              resizeMode="contain"
            />
          </View>

          {/* Bottom Actions */}
          <View style={styles.bottomActions}>
            {isExpoGo && (
              <View style={styles.devNoteBox}>
                <Text style={styles.devNoteText}>
                  Running in Expo Go: permission can be granted, but a
                  server-sent notification only reaches the tray in a
                  development build.
                </Text>
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.allowButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleAllow}
              disabled={isRequesting}
              accessibilityRole="button"
            >
              {isRequesting ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.allowButtonText}>Allow notifications</Text>
              )}
            </Pressable>

            {permissionError && (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{permissionError}</Text>
                {showSettings && Platform.OS !== 'web' && (
                  <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button">
                    <Text style={styles.settingsText}>Open device settings</Text>
                  </Pressable>
                )}
              </View>
            )}

            <Pressable
              style={({ pressed }) => [
                styles.notNowButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleNotNow}
              disabled={isRequesting}
              accessibilityRole="button"
            >
              <Text style={styles.notNowButtonText}>Not now</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFCF7', // Matches brand offWhite canvas
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg, // 20px
    paddingTop: Spacing.xl, // 24px
    paddingBottom: Spacing.xxl, // 40px
    justifyContent: 'space-between',
  },
  headingSection: {
    gap: 4,
  },
  title: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.7,
    color: Colors.navy, // #0A1931
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: Colors.text.primary, // #3A4761
  },
  cardsContainer: {
    gap: 8,
    marginTop: Spacing.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  cardText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.navy, // #0A1931
  },
  illustrationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: Spacing.lg,
    flex: 1,
    minHeight: 180,
  },
  bellImage: {
    width: '85%',
    height: 220,
    maxWidth: 290,
  },
  bottomActions: {
    gap: 8,
    marginTop: Spacing.md,
  },
  allowButton: {
    width: '100%',
    backgroundColor: '#5F4DB2',
    paddingVertical: 18,
    borderRadius: Radii.pill, // 999
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  allowButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  notNowButton: {
    width: '100%',
    backgroundColor: 'transparent',
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notNowButtonText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.text.primary, // #3A4761
  },
  devNoteBox: {
    backgroundColor: Colors.amber.bg,
    borderRadius: Radii.input,
    padding: Spacing.md,
  },
  devNoteText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 17,
    color: Colors.amber.fg,
    textAlign: 'center',
  },
  errorBox: {
    backgroundColor: Colors.red.bg,
    borderRadius: Radii.input,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  errorText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.red.fg,
    textAlign: 'center',
  },
  settingsText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.navy,
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});
