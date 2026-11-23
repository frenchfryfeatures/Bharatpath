/**
 * Native notification permission and presentation.
 *
 * Requests OS permission, registers the Expo device token with our backend,
 * and presents remote notifications while the app is in the foreground.
 *
 * **`expo-notifications` is required lazily, never at module load.** Expo Go
 * dropped push support in SDK 53, and importing the module there throws at
 * import time - which took down the whole app from `app/_layout.tsx`, since
 * that is where presentation is configured. Requiring it inside a try/catch
 * keeps Expo Go usable and turns a missing capability into a message.
 */
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { isRunningInExpoGo } from 'expo';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerPushDevice, unregisterPushDevice, updatePushPreference } from '@/services/api/notifications';

type NotificationsModule = typeof import('expo-notifications');

let cachedModule: NotificationsModule | null | undefined;
let configured = false;
const PUSH_TOKEN_KEY = '@bharatpath:push_token';
const PUSH_REGISTERED_AT_KEY = '@bharatpath:push_registered_at';
const PUSH_REREGISTER_MS = 24 * 60 * 60 * 1000;

/** True in the Expo Go sandbox, false in a development or production build. */
export const isExpoGo =
  isRunningInExpoGo() ||
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Remote (server-sent) push needs a development build. Local notifications
 * still work in Expo Go, so this is not the same question as "is the module
 * available".
 */
export const supportsRemotePush = Platform.OS !== 'web' && !isExpoGo;

function loadNotifications(): NotificationsModule | null {
  if (cachedModule !== undefined) return cachedModule;
  if (Platform.OS === 'web' || isExpoGo) {
    cachedModule = null;
    return cachedModule;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cachedModule = require('expo-notifications') as NotificationsModule;
  } catch (error) {
    console.warn('[Notifications] module unavailable on this runtime', error);
    cachedModule = null;
  }
  return cachedModule;
}

export function configureNotificationPresentation(): void {
  if (configured) return;
  const Notifications = loadNotifications();
  if (!Notifications) return;
  configured = true;

  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch (error) {
    console.warn('[Notifications] could not set the foreground handler', error);
  }
}

export type NotificationPermissionResult =
  | { status: 'granted'; remotePushAvailable: boolean }
  | { status: 'denied'; canAskAgain: boolean }
  /** No notification capability on this runtime (web, or the module is absent). */
  | { status: 'unsupported'; reason: 'web' | 'runtime' };

export async function getDeviceNotificationStatus(): Promise<NotificationPermissionResult> {
  const Notifications = loadNotifications();
  if (!Notifications) return { status: 'unsupported', reason: Platform.OS === 'web' ? 'web' : 'runtime' };
  const permission = await Notifications.getPermissionsAsync();
  return permission.granted
    ? { status: 'granted', remotePushAvailable: supportsRemotePush }
    : { status: 'denied', canAskAgain: permission.canAskAgain };
}

export async function syncPushDevice(): Promise<boolean> {
  const Notifications = loadNotifications();
  if (!Notifications || !supportsRemotePush) return false;
  const permission = await Notifications.getPermissionsAsync();
  const previous = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  if (!permission.granted) {
    if (previous) {
      await unregisterPushDevice(previous);
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    }
    return false;
  }
  if (Platform.OS === 'android') await ensureAndroidChannel(Notifications);
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) {
    console.warn('[Notifications] Push notification project ID is missing from the app build.');
    return false;
  }
  try {
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    // Ran on every app start and every return to the foreground. The token
    // rarely changes, so register only when it did or the last registration
    // is over a day old (2026-11-23). Sign-out clears both keys, so another
    // account on the same phone still registers.
    const registeredAt = Number(await AsyncStorage.getItem(PUSH_REGISTERED_AT_KEY)) || 0;
    if (previous === token && Date.now() - registeredAt < PUSH_REREGISTER_MS) return true;
    await registerPushDevice(token, Platform.OS as 'android' | 'ios');
    if (previous && previous !== token) await unregisterPushDevice(previous).catch(() => undefined);
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
    await AsyncStorage.setItem(PUSH_REGISTERED_AT_KEY, String(Date.now()));
    return true;
  } catch (error) {
    console.warn('[Notifications] Failed to fetch or register Expo push token:', error);
    return false;
  }
}

export async function unregisterCurrentPushDevice(): Promise<void> {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  if (!token) return;
  await unregisterPushDevice(token);
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
  await AsyncStorage.removeItem(PUSH_REGISTERED_AT_KEY);
}

async function ensureAndroidChannel(Notifications: NotificationsModule): Promise<void> {
  await Notifications.setNotificationChannelAsync('default', {
    name: 'BharatPath updates',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 200, 250],
    lightColor: '#5F4DB2',
    sound: 'default',
  });
}

export async function requestDeviceNotificationPermission(): Promise<NotificationPermissionResult> {
  if (Platform.OS === 'web') {
    return { status: 'unsupported', reason: 'web' };
  }

  const Notifications = loadNotifications();
  if (!Notifications) {
    return { status: 'unsupported', reason: 'runtime' };
  }

  configureNotificationPresentation();

  if (Platform.OS === 'android') {
    // The channel carries the importance: without a HIGH one, Android files
    // the notification silently instead of showing it in the tray.
    await ensureAndroidChannel(Notifications);
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) {
    return { status: 'granted', remotePushAvailable: supportsRemotePush };
  }

  const requested = await Notifications.requestPermissionsAsync({
    ios: {
      allowAlert: true,
      allowBadge: true,
      allowSound: true,
    },
  });

  if (requested.granted) {
    return { status: 'granted', remotePushAvailable: supportsRemotePush };
  }
  return { status: 'denied', canAskAgain: requested.canAskAgain };
}

export async function enablePushNotifications(): Promise<NotificationPermissionResult> {
  const result = await requestDeviceNotificationPermission();
  if (result.status !== 'granted') return result;
  try {
    await updatePushPreference(true);
  } catch (error) {
    console.warn('[Notifications] Failed to update push preference on server:', error);
  }
  try {
    await syncPushDevice();
  } catch (error) {
    console.warn('[Notifications] Failed to sync push device with server:', error);
  }
  return result;
}

/** What a tapped push carries for the app: its inbox id and destination. */
export interface PushOpen {
  notificationId: string | null;
  destination: unknown;
}

const HANDLED_PUSH_KEY = '@bharatpath:handled_push_ids';
const MAX_REMEMBERED = 50;
/** A notification delivered longer ago than this is not what launched us. */
const STALE_RESPONSE_MS = 24 * 60 * 60 * 1000;

/**
 * Whether this tap has been acted on before. Android keeps the "last
 * notification response" across cold starts, and `clearLastNotification-
 * ResponseAsync` does not reliably clear it there, so without this an old tap
 * re-opened the inbox on every launch -- and again on every sign-in, because
 * the bridge re-runs when the user changes (email verification included).
 */
async function claimResponse(identifier: string): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(HANDLED_PUSH_KEY);
    const seen: string[] = raw ? JSON.parse(raw) : [];
    if (seen.includes(identifier)) return false;
    await AsyncStorage.setItem(
      HANDLED_PUSH_KEY,
      JSON.stringify([identifier, ...seen].slice(0, MAX_REMEMBERED)),
    );
    return true;
  } catch {
    return true;
  }
}

function toPushOpen(response: any): PushOpen {
  const data = response?.notification?.request?.content?.data ?? {};
  return {
    notificationId: typeof data.notificationId === 'string' ? data.notificationId : null,
    destination: data.destination,
  };
}

function isOpenTap(Notifications: NotificationsModule, response: any): boolean {
  // Only the notification body being tapped opens something. A dismissal or
  // a custom action button is not a request to navigate.
  return response?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER;
}

export function subscribeToPushEvents(onOpen: (open: PushOpen) => void): () => void {
  const Notifications = loadNotifications();
  if (!Notifications) return () => undefined;
  const response = Notifications.addNotificationResponseReceivedListener((tap) => {
    if (!isOpenTap(Notifications, tap)) return;
    const identifier = tap.notification.request.identifier;
    claimResponse(identifier)
      .then((fresh) => { if (fresh) onOpen(toPushOpen(tap)); })
      .catch(() => undefined);
  });
  const token = Notifications.addPushTokenListener(() => {
    syncPushDevice().catch((error) => console.warn('[Notifications] token refresh failed', error));
  });
  return () => {
    response.remove();
    token.remove();
  };
}

/**
 * The tap that launched the app, if there was one and it is new. Called once
 * per process; a response already handled, or older than a launch tap could
 * be, is cleared and ignored rather than replayed.
 */
export async function openInitialPushResponse(onOpen: (open: PushOpen) => void): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  const response = await Notifications.getLastNotificationResponseAsync();
  if (!response) return;
  await Notifications.clearLastNotificationResponseAsync().catch(() => undefined);
  if (!isOpenTap(Notifications, response)) return;
  const fresh = await claimResponse(response.notification.request.identifier);
  if (!fresh) return;
  const sentAt = response.notification.date;
  if (typeof sentAt === 'number' && sentAt > 0 && Date.now() - sentAt > STALE_RESPONSE_MS) {
    // Older than a day: a stale response a launcher start replayed.
    return;
  }
  onOpen(toPushOpen(response));
}
