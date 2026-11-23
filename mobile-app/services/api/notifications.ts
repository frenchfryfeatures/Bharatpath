import { apiRequest } from './client';
import type { NotificationDestination } from '@/services/notifications/destination';

export interface NotificationPreferences {
  locale: string;
  sms_enabled: boolean;
  email_enabled: boolean;
  push_enabled: boolean;
  nudges_enabled: boolean;
}

export interface InboxItem {
  id: string;
  template_code: string;
  body: string;
  created_at: string;
  read_at: string | null;
  /** Where tapping it leads. Absent on servers before 2026-11-23. */
  destination?: NotificationDestination | null;
}

export interface InboxPage {
  items: InboxItem[];
  next_cursor: string | null;
  unread: number;
}

export async function getInbox(
  cursor?: string | null,
  limit?: number,
): Promise<InboxPage> {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  if (limit != null) params.set('limit', String(limit));
  const qs = params.toString();
  const path = qs ? `/notifications?${qs}` : '/notifications';
  return apiRequest<InboxPage>(path);
}

export async function markNotificationRead(
  notificationId: string,
): Promise<InboxItem> {
  return apiRequest<InboxItem>(`/notifications/${notificationId}/read`, {
    method: 'POST',
  });
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  return apiRequest<NotificationPreferences>('/notifications/preferences');
}

export async function updatePushPreference(
  pushEnabled: boolean,
): Promise<NotificationPreferences> {
  return apiRequest<NotificationPreferences>('/notifications/preferences', {
    method: 'PATCH',
    body: { push_enabled: pushEnabled },
  });
}

export async function registerPushDevice(token: string, platform: 'android' | 'ios'): Promise<void> {
  await apiRequest('/notifications/devices', {
    method: 'POST',
    body: { token, platform },
  });
}

export async function unregisterPushDevice(token: string): Promise<void> {
  await apiRequest('/notifications/devices', {
    method: 'DELETE',
    body: { token },
  });
}

// ─── Unread count, shared (2026-11-23) ─────────────────────────
// Home and every tab's bell asked the inbox for the unread count on each
// visit. One request now serves them all: concurrent callers share it, and a
// count younger than UNREAD_REUSE_MS is reused. The inbox screen, which has
// the real number, reports it here so the bells stay right.
const UNREAD_REUSE_MS = 20_000;
let unreadValue: number | null = null;
let unreadAt = 0;
let unreadInFlight: Promise<number> | null = null;

export function cachedUnreadCount(): number | null {
  return unreadValue;
}

export function noteUnreadCount(count: number): void {
  unreadValue = count;
  unreadAt = Date.now();
}

export function forgetUnreadCount(): void {
  unreadValue = null;
  unreadAt = 0;
  unreadInFlight = null;
}

export function getUnreadCount(): Promise<number> {
  if (unreadValue !== null && Date.now() - unreadAt < UNREAD_REUSE_MS) {
    return Promise.resolve(unreadValue);
  }
  if (!unreadInFlight) {
    unreadInFlight = getInbox(null, 1)
      .then((page) => {
        noteUnreadCount(page.unread);
        return page.unread;
      })
      .finally(() => {
        unreadInFlight = null;
      });
  }
  return unreadInFlight;
}
