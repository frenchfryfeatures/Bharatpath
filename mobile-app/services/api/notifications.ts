import { apiRequest } from './client';

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
