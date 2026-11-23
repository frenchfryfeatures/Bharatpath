/**
 * Bottom-tab navigation (2026-11-23).
 *
 * The tabs live on a plain Stack, and every tab tap used to `router.push`, so
 * Home -> Jobs -> Board -> Home built a new copy of each screen on top of the
 * last: each copy started empty (loader, all of its requests again) while
 * the old copies stayed mounted underneath, all listening for focus.
 *
 * Now Home stays at the bottom and is *returned to* (the same instance, with
 * its data on screen), and moving between the other tabs replaces the current
 * one, so the stack never holds more than Home plus one tab.
 */
import type { Router } from 'expo-router';
import type { TabName } from '@/components/navigation/BottomTabBar';

export function navigateToTab(router: Router, from: TabName, to: TabName, href: string): void {
  if (to === from) return;
  if (to === 'home') {
    // Pops back to the existing Home; if there is none, replaces with one.
    router.dismissTo('/home' as any);
    return;
  }
  if (from === 'home' || from === 'preview') {
    router.push(href as any);
    return;
  }
  router.replace(href as any);
}
