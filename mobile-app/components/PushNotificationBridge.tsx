import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthContext } from '@/context/AuthContext';
import {
  openInitialPushResponse,
  subscribeToPushEvents,
  syncPushDevice,
  type PushOpen,
} from '@/services/notifications/device';
import { markNotificationRead } from '@/services/api/notifications';
import { parseDestination, routeForDestination } from '@/services/notifications/destination';

/**
 * Registers this device for push and opens what a tapped push points at.
 *
 * Before 2026-11-23 every tap -- and every stale "last response" Android
 * replays on a cold start or a fresh sign-in -- pushed `/notifications`, so
 * the app opened on the inbox for no reason the user could see. Now only a
 * new, real tap navigates, and it goes where the message is about.
 */
export function PushNotificationBridge() {
  const { session } = useAuthContext();
  const router = useRouter();
  const userId = session?.userId;
  const initialChecked = useRef(false);

  useEffect(() => {
    if (!userId) return;
    const open = ({ notificationId, destination }: PushOpen) => {
      if (notificationId) markNotificationRead(notificationId).catch(() => undefined);
      const parsed = parseDestination(destination);
      router.push((parsed ? routeForDestination(parsed) : '/notifications') as any);
    };
    const sync = () => syncPushDevice().catch((error) =>
      console.warn('[Notifications] device registration failed', error));
    sync();
    // The launch tap belongs to this process start, not to each sign-in.
    if (!initialChecked.current) {
      initialChecked.current = true;
      openInitialPushResponse(open).catch(() => undefined);
    }
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    const unsubscribe = subscribeToPushEvents(open);
    return () => {
      appState.remove();
      unsubscribe();
    };
  }, [userId, router]);
  return null;
}
