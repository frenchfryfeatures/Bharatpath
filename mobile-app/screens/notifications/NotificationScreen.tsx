/**
 * BharatPath - NotificationScreen
 *
 * Shows the candidate's real in-app inbox from `GET /api/v1/notifications`
 * (newest first, cursor-paginated) and marks items read on tap via
 * `POST /notifications/{id}/read`.
 *
 * Backend contract (`backend/app/modules/notifications/schemas.py`):
 *   - `InboxPage`: items[], next_cursor, unread
 *   - `InboxItem`: id, template_code, body, created_at, read_at
 *
 * The `body` is rendered server-side in the reader's language - the app just
 * displays it. The `template_code` picks an icon and (optionally) a tap
 * destination. No score, amount, or third-party name is ever in a body
 * (invariant: the inbox obeys the same rules as every other channel).
 *
 * The "Can we message you?" onboarding card collapses to a small banner once
 * notifications have been allowed, so the inbox is the main content.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { Linking, Platform } from 'react-native';
import {
  ArrowLeft,
  BellSimpleRinging,
  CheckCircle,
  ChatCircleText,
  Eye,
  Target,
  CreditCard,
  WarningCircle,
  Clock,
  MicrophoneStage,
  ShieldCheck,
  Question,
  UserMinus,
  Scales,
  FileText,
} from 'phosphor-react-native';
import { Colors, Spacing, Radii } from '@/theme/tokens';
import {
  InboxItem,
  getInbox,
  markNotificationRead,
  getNotificationPreferences,
} from '@/services/api/notifications';
import { enablePushNotifications, getDeviceNotificationStatus } from '@/services/notifications/device';

export interface NotificationScreenProps {
  onBack?: () => void;
  onAllow?: () => void;
  onNotNow?: () => void;
  initialEnabled?: boolean;
}

export function NotificationScreen({
  onBack,
  onAllow,
  onNotNow,
  initialEnabled = false,
}: NotificationScreenProps) {
  const router = useRouter();
  const [isEnabled, setIsEnabled] = useState(initialEnabled);
  const [permissionGranted, setPermissionGranted] = useState(initialEnabled);
  const [accountPushDisabled, setAccountPushDisabled] = useState(false);
  const [checkingPermission, setCheckingPermission] = useState(true);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [openSettings, setOpenSettings] = useState(false);
  const [items, setItems] = useState<InboxItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const page = await getInbox(null, 30);
      setItems(page.items);
      setUnread(page.unread);
      setCursor(page.next_cursor);
      setHasMore(page.next_cursor != null);
    } catch {
      setError('Could not load your notifications.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(useCallback(() => {
    let active = true;
    getDeviceNotificationStatus()
      .then(async (permission) => {
        if (!active) return;
        const granted = permission.status === 'granted';
        setPermissionGranted(granted);
        setOpenSettings(permission.status === 'denied' && !permission.canAskAgain);
        try {
          const preference = await getNotificationPreferences();
          if (!active) return;
          setAccountPushDisabled(granted && !preference.push_enabled);
          setIsEnabled(granted && preference.push_enabled);
        } catch {
          // The phone's granted permission remains true while offline.
          if (active) setIsEnabled(granted);
        }
      })
      .catch(() => {
        if (active) {
          setIsEnabled(false);
          setPermissionGranted(false);
        }
      })
      .finally(() => { if (active) setCheckingPermission(false); });
    return () => { active = false; };
  }, []));

  const loadMore = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await getInbox(cursor, 30);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.next_cursor);
      setHasMore(page.next_cursor != null);
    } catch {
      // Silent: the first page is already shown.
    } finally {
      setLoadingMore(false);
    }
  }, [cursor, loadingMore]);

  const handleTap = async (item: InboxItem) => {
    // Mark read optimistically.
    if (!item.read_at) {
      setItems((prev) =>
        prev.map((n) =>
          n.id === item.id ? { ...n, read_at: new Date().toISOString() } : n,
        ),
      );
      setUnread((u) => Math.max(0, u - 1));
      try {
        await markNotificationRead(item.id);
      } catch {
        // Revert on failure.
        setItems((prev) =>
          prev.map((n) => (n.id === item.id ? { ...n, read_at: null } : n)),
        );
        setUnread((u) => u + 1);
      }
    }
    const dest = destinationFor(item.template_code);
    if (dest) {
      try {
        router.push(dest as any);
      } catch {
        router.push('/home');
      }
    }
  };

  const handleAllow = async () => {
    if (requestingPermission) return;
    setRequestingPermission(true);
    setPermissionError(null);
    try {
      const result = await enablePushNotifications();
      if (result.status === 'granted') {
        setIsEnabled(true);
        setPermissionGranted(true);
        setAccountPushDisabled(false);
        setOpenSettings(false);
        onAllow?.();
      } else if (result.status === 'denied') {
        setOpenSettings(!result.canAskAgain);
        setPermissionError('Notifications are blocked. Allow them in your phone settings, then return here.');
      } else {
        setPermissionError('Phone notifications require an installed Android or iOS app build.');
      }
    } catch {
      // Permission may have succeeded even if token registration failed.
      // Keep the OS prompt hidden once the phone has already granted it.
      const current = await getDeviceNotificationStatus().catch(() => null);
      if (current?.status === 'granted') setPermissionGranted(true);
      setPermissionError('Could not enable notifications. Check your connection and try again.');
    } finally {
      setRequestingPermission(false);
    }
  };

  const handleNotNow = () => {
    if (onNotNow) onNotNow();
    else if (onBack) onBack();
    else if (router.canGoBack()) router.back();
  };

  const goBack = () => {
    if (onBack) onBack();
    else if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {/* Top Bar */}
        <View style={styles.topBar}>
          <Pressable
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={goBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <ArrowLeft size={16} color={Colors.navy} weight="bold" />
          </Pressable>
          <Text style={styles.topBarTitle}>Notifications</Text>
          {unread > 0 && (
            <View style={styles.unreadBadge}>
              <Text style={styles.unreadBadgeText}>{unread}</Text>
            </View>
          )}
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={loading && items.length === 0}
              onRefresh={load}
            />
          }
          onScroll={({ nativeEvent }) => {
            const { layoutMeasurement, contentOffset, contentSize } =
              nativeEvent;
            if (
              hasMore &&
              !loadingMore &&
              layoutMeasurement.height + contentOffset.y >=
                contentSize.height - 200
            ) {
              loadMore();
            }
          }}
          scrollEventThrottle={16}
        >
          {!checkingPermission && permissionGranted && permissionError && (
            <View style={styles.onboardingCard}>
              <Text style={styles.onboardingTitle}>Phone permission is on</Text>
              <Text style={styles.onboardingSubtitle}>{permissionError}</Text>
              <Pressable style={styles.allowButton} onPress={handleAllow} disabled={requestingPermission} accessibilityRole="button">
                <Text style={styles.allowButtonText}>{requestingPermission ? 'Trying...' : 'Retry connection'}</Text>
              </Pressable>
            </View>
          )}
          {/* Onboarding banner - only when notifications not yet allowed */}
          {!checkingPermission && permissionGranted && accountPushDisabled && !permissionError && (
            <View style={styles.onboardingCard}>
              <Text style={styles.onboardingTitle}>Account alerts are paused</Text>
              <Text style={styles.onboardingSubtitle}>Phone permission is on. Enable alerts for your BharatPath account.</Text>
              <Pressable style={styles.allowButton} onPress={handleAllow} disabled={requestingPermission} accessibilityRole="button">
                <Text style={styles.allowButtonText}>{requestingPermission ? 'Enabling...' : 'Enable account alerts'}</Text>
              </Pressable>
            </View>
          )}
          {!checkingPermission && !permissionGranted && (
            <View style={styles.onboardingCard}>
              <Text style={styles.onboardingTitle}>Can we message you?</Text>
              <Text style={styles.onboardingSubtitle}>
                Only these three things. Nothing else, ever.
              </Text>
              <View style={styles.onboardingPoints}>
                <View style={styles.onboardingPoint}>
                  <Eye size={16} color={Colors.indigo} weight="duotone" />
                  <Text style={styles.onboardingPointText}>
                    An employer opened your profile
                  </Text>
                </View>
                <View style={styles.onboardingPoint}>
                  <ChatCircleText
                    size={16}
                    color={Colors.navy}
                    weight="duotone"
                  />
                  <Text style={styles.onboardingPointText}>
                    Your application moved forward
                  </Text>
                </View>
                <View style={styles.onboardingPoint}>
                  <Target size={16} color={Colors.navy} weight="duotone" />
                  <Text style={styles.onboardingPointText}>
                    A job you nearly qualify for opened
                  </Text>
                </View>
              </View>
              <View style={styles.illustrationContainer}>
                <Image
                  source={require('@/assets/icons/notify-bell.png')}
                  style={styles.bellImage}
                  resizeMode="contain"
                />
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.allowButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleAllow}
                disabled={requestingPermission}
                accessibilityRole="button"
              >
                {requestingPermission ? <ActivityIndicator color="#FFFFFF" /> : <BellSimpleRinging size={18} color="#FFFFFF" weight="bold" />}
                <Text style={styles.allowButtonText}>{requestingPermission ? 'Enabling...' : 'Allow notifications'}</Text>
              </Pressable>
              {permissionError && <Text style={styles.onboardingSubtitle}>{permissionError}</Text>}
              {openSettings && Platform.OS !== 'web' && (
                <Pressable onPress={() => Linking.openSettings()} accessibilityRole="button">
                  <Text style={styles.onboardingSubtitle}>Open phone settings</Text>
                </Pressable>
              )}
              <Pressable
                style={({ pressed }) => [
                  styles.notNowButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleNotNow}
                accessibilityRole="button"
              >
                <Text style={styles.notNowButtonText}>Not now</Text>
              </Pressable>
            </View>
          )}

          {/* Inbox */}
          {loading && items.length === 0 ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={Colors.indigo} />
              <Text style={styles.centerTitle}>Loading your notifications</Text>
            </View>
          ) : error ? (
            <View style={styles.centerState}>
              <WarningCircle size={42} color="#993A22" weight="fill" />
              <Text style={styles.centerTitle}>Could not load</Text>
              <Text style={styles.centerBody}>{error}</Text>
              <Pressable style={styles.primaryButton} onPress={load}>
                <Text style={styles.primaryButtonText}>Try again</Text>
              </Pressable>
            </View>
          ) : items.length === 0 ? (
            <View style={styles.centerState}>
              <BellSimpleRinging
                size={44}
                color={Colors.indigo}
                weight="duotone"
              />
              <Text style={styles.centerTitle}>No notifications yet</Text>
              <Text style={styles.centerBody}>
                When an employer views your profile, your application moves
                forward, or your interview feedback is ready, it will show up
                here.
              </Text>
            </View>
          ) : (
            <View style={styles.inboxList}>
              {items.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  onPress={() => handleTap(item)}
                />
              ))}
              {loadingMore && (
                <View style={styles.loadingMoreRow}>
                  <ActivityIndicator size="small" color={Colors.indigo} />
                </View>
              )}
              {isEnabled && (
                <View style={styles.enabledFooter}>
                  <CheckCircle size={16} color="#15803D" weight="fill" />
                  <Text style={styles.enabledFooterText}>
                    Notifications are enabled for your account.
                  </Text>
                </View>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

/** A single notification row. Unread items get a stronger visual weight. */
function NotificationRow({
  item,
  onPress,
}: {
  item: InboxItem;
  onPress: () => void;
}) {
  const isUnread = !item.read_at;
  const icon = iconFor(item.template_code);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        isUnread && styles.rowUnread,
        pressed && styles.buttonPressed,
      ]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <View style={[styles.rowIcon, { backgroundColor: icon.bg }]}>
        {icon.node}
      </View>
      <View style={styles.rowCopy}>
        <Text
          style={[styles.rowBody, isUnread && styles.rowBodyUnread]}
          numberOfLines={3}
        >
          {item.body}
        </Text>
        <Text style={styles.rowTime}>{formatRelative(item.created_at)}</Text>
      </View>
      {isUnread && <View style={styles.unreadDot} />}
    </Pressable>
  );
}

/** Pick an icon + tint for a template code. Falls back to a bell. */
function iconFor(code: string): { node: React.ReactNode; bg: string } {
  const indigo = '#F1EAF7';
  const navy = '#E7E0D4';
  const green = '#DFF2E6';
  const amber = '#F4EFD8';
  const red = '#F8E2DC';
  switch (code) {
    case 'IN_APP_APPLICATION_SENT':
      return {
        node: <CheckCircle size={18} color="#1F7A4D" weight="fill" />,
        bg: green,
      };
    case 'IN_APP_APPLICATION_UPDATE':
      return {
        node: <ChatCircleText size={18} color={Colors.navy} weight="duotone" />,
        bg: navy,
      };
    case 'IN_APP_PAYMENT_RECEIVED':
      return {
        node: <CreditCard size={18} color="#1F7A4D" weight="duotone" />,
        bg: green,
      };
    case 'IN_APP_PAYMENT_FAILED':
      return {
        node: <CreditCard size={18} color="#993A22" weight="duotone" />,
        bg: red,
      };
    case 'IN_APP_ACCESS_ENDED':
      return {
        node: <Clock size={18} color="#7A5C0E" weight="duotone" />,
        bg: amber,
      };
    case 'IN_APP_PRE_DEBIT':
      return {
        node: <CreditCard size={18} color={Colors.indigo} weight="duotone" />,
        bg: indigo,
      };
    case 'IN_APP_KYB_APPROVED':
      return {
        node: <ShieldCheck size={18} color="#1F7A4D" weight="duotone" />,
        bg: green,
      };
    case 'IN_APP_KYB_NEEDS_INFO':
      return {
        node: <ShieldCheck size={18} color="#7A5C0E" weight="duotone" />,
        bg: amber,
      };
    case 'IN_APP_INTERVIEW_FEEDBACK_READY':
    case 'IN_APP_INTERVIEW_INVITATION':
      return {
        node: (
          <MicrophoneStage size={18} color={Colors.indigo} weight="duotone" />
        ),
        bg: indigo,
      };
    case 'IN_APP_ASSESSMENT_INVITATION':
      return {
        node: <Target size={18} color={Colors.indigo} weight="duotone" />,
        bg: indigo,
      };
    case 'IN_APP_EMPLOYER_MESSAGE':
      return {
        node: <ChatCircleText size={18} color="#1F7A4D" weight="duotone" />,
        bg: green,
      };
    case 'IN_APP_COLLEGE_STUDENT_DISCONNECTED':
    case 'IN_APP_COLLEGE_STUDENT_STOPPED_SHARING':
      return {
        node: <UserMinus size={18} color={Colors.navy} weight="duotone" />,
        bg: navy,
      };
    case 'IN_APP_DISPUTE_ANSWERED':
      return {
        node: <Scales size={18} color={Colors.indigo} weight="duotone" />,
        bg: indigo,
      };
    case 'IN_APP_PROFILE_INCOMPLETE':
      return {
        node: <FileText size={18} color="#7A5C0E" weight="duotone" />,
        bg: amber,
      };
    default:
      return {
        node: <Question size={18} color={Colors.navy} weight="duotone" />,
        bg: navy,
      };
  }
}

/** Where tapping a notification should go. Always routes to an existing valid screen. */
function destinationFor(code: string): string {
  switch (code) {
    case 'IN_APP_APPLICATION_SENT':
    case 'IN_APP_APPLICATION_UPDATE':
    case 'IN_APP_EMPLOYER_MESSAGE':
    case 'IN_APP_DISPUTE_ANSWERED':
      return '/board';
    case 'IN_APP_PAYMENT_RECEIVED':
    case 'IN_APP_PAYMENT_FAILED':
    case 'IN_APP_ACCESS_ENDED':
    case 'IN_APP_PRE_DEBIT':
      return '/you';
    case 'IN_APP_INTERVIEW_FEEDBACK_READY':
    case 'IN_APP_INTERVIEW_INVITATION':
      return '/interview-sessions';
    case 'IN_APP_ASSESSMENT_INVITATION':
    case 'IN_APP_PROFILE_INCOMPLETE':
      return '/attribute-check';
    case 'IN_APP_COURSE_ENROLLED':
    case 'IN_APP_COURSE_COMPLETED':
      return '/courses';
    default:
      if (
        code.includes('PAYMENT') ||
        code.includes('ACCESS') ||
        code.includes('SUB') ||
        code.includes('BILL') ||
        code.includes('INVOICE')
      ) {
        return '/you';
      }
      if (code.includes('INTERVIEW')) {
        return '/interview-sessions';
      }
      if (code.includes('COURSE') || code.includes('LESSON')) {
        return '/courses';
      }
      if (code.includes('JOB') || code.includes('APPLICAT') || code.includes('OFFER')) {
        return '/board';
      }
      if (code.includes('STREAK')) {
        return '/streak';
      }
      return '/home';
  }
}

/** "2m", "3h", "Yesterday", "Mon 15 Jul" - short relative time. */
function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHr = Math.floor(diffMs / 3_600_000);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const startOfThat = new Date(
    d.getFullYear(),
    d.getMonth(),
    d.getDate(),
  ).getTime();
  const dayDiff = Math.round((startOfThat - startOfToday) / 86_400_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24 && dayDiff === 0) return `${diffHr}h ago`;
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff > 1 && dayDiff < 7) {
    return d.toLocaleDateString('en-IN', {
      weekday: 'short',
      timeZone: 'Asia/Kolkata',
    });
  }
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFCF7',
  },
  safeArea: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBarTitle: {
    flex: 1,
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: Colors.navy,
  },
  unreadBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 7,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  unreadBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    color: '#FFFFFF',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: Spacing.xl,
    gap: 12,
    flexGrow: 1,
  },
  // Onboarding card (shown only until notifications are allowed)
  onboardingCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: Radii.card,
    padding: 20,
    gap: 14,
  },
  onboardingTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 24,
    lineHeight: 28,
    letterSpacing: -0.5,
    color: Colors.navy,
  },
  onboardingSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#3A4761',
  },
  onboardingPoints: {
    gap: 8,
  },
  onboardingPoint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  onboardingPointText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.navy,
  },
  illustrationContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 4,
  },
  bellImage: {
    width: '70%',
    height: 140,
    alignSelf: 'center',
  },
  allowButton: {
    backgroundColor: '#5F4DB2',
    borderRadius: Radii.pill,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  allowButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  notNowButton: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  notNowButtonText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: '#3A4761',
  },
  // Inbox
  inboxList: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: Radii.input,
    padding: 14,
  },
  rowUnread: {
    borderColor: '#5F4DB2',
    borderWidth: 1.5,
    backgroundColor: '#FBFAFF',
  },
  rowIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowCopy: {
    flex: 1,
    gap: 4,
  },
  rowBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#3A4761',
  },
  rowBodyUnread: {
    fontFamily: 'GeneralSans-Semibold',
    color: Colors.navy,
  },
  rowTime: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: '#5F6B80',
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#5F4DB2',
    marginTop: 6,
  },
  loadingMoreRow: {
    paddingVertical: 16,
    alignItems: 'center',
  },
  enabledFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  enabledFooterText: {
    flex: 1,
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#15803D',
  },
  // Center states
  centerState: {
    flex: 1,
    minHeight: 300,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 10,
  },
  centerTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 20,
    color: Colors.navy,
    textAlign: 'center',
  },
  centerBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#3A4761',
    textAlign: 'center',
  },
  primaryButton: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: Radii.pill,
    backgroundColor: '#5F4DB2',
    marginTop: 4,
  },
  primaryButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
});
