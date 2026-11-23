/**
 * Log out from anywhere (2026-11-23).
 *
 * Clears the session and per-user state (AuthContext.signOut), then empties
 * the navigation stack before showing sign-in. `router.replace` alone left
 * authenticated screens underneath, so Android back returned to them; and
 * several sign-out buttons cleared the session without navigating at all.
 */
import { useCallback, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useAuthContext } from '@/context/AuthContext';
import { logger } from '@/utils/logger';

export function useLogout() {
  const router = useRouter();
  const { signOut } = useAuthContext();
  const running = useRef(false);
  return useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      await signOut();
    } catch (error) {
      logger.warn('Auth', 'Sign out did not finish cleanly; local session cleared', error);
    } finally {
      running.current = false;
      if (router.canDismiss()) router.dismissAll();
      router.replace({ pathname: '/', params: { step: 'login' } } as any);
    }
  }, [router, signOut]);
}
