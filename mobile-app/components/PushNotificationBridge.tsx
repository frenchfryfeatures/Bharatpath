import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuthContext } from '@/context/AuthContext';
import { openInitialPushResponse, subscribeToPushEvents, syncPushDevice } from '@/services/notifications/device';

export function PushNotificationBridge() {
  const { session } = useAuthContext();
  const router = useRouter();
  const userId = session?.userId;

  useEffect(() => {
    if (!userId) return;
    const sync = () => syncPushDevice().catch((error) =>
      console.warn('[Notifications] device registration failed', error));
    sync();
    openInitialPushResponse(() => router.push('/notifications')).catch(() => undefined);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') sync();
    });
    const unsubscribe = subscribeToPushEvents(() => router.push('/notifications'));
    return () => {
      appState.remove();
      unsubscribe();
    };
  }, [userId, router]);
  return null;
}
