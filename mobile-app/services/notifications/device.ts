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
  if (!projectId) throw new Error('Push notification project ID is missing from the app build.');
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await registerPushDevice(token, Platform.OS as 'android' | 'ios');
  if (previous && previous !== token) await unregisterPushDevice(previous).catch(() => undefined);
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);
  return true;
}

export async function unregisterCurrentPushDevice(): Promise<void> {
  const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
  if (!token) return;
  await unregisterPushDevice(token);
  await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
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
  await updatePushPreference(true);
  await syncPushDevice();
  return result;
}

export function subscribeToPushEvents(onOpen: () => void): () => void {
  const Notifications = loadNotifications();
  if (!Notifications) return () => undefined;
  const response = Notifications.addNotificationResponseReceivedListener(onOpen);
  const token = Notifications.addPushTokenListener(() => {
    syncPushDevice().catch((error) => console.warn('[Notifications] token refresh failed', error));
  });
  return () => {
    response.remove();
    token.remove();
  };
}

export async function openInitialPushResponse(onOpen: () => void): Promise<void> {
  const Notifications = loadNotifications();
  if (!Notifications) return;
  const response = await Notifications.getLastNotificationResponseAsync();
  if (response) {
    await Notifications.clearLastNotificationResponseAsync();
    onOpen();
  }
}
