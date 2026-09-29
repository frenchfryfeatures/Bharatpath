export type NotificationType =
  | "STUDENT_LINKED"
  | "CONSENT_PENDING"
  | "PAYMENT"
  | "ROSTER"
  | "HIRING"
  | "JOB"
  | "SECURITY"
  | "SYSTEM";

export interface Notification {
  id: string;

  templateCode: string;

  type: NotificationType;

  title: string;

  message?: string | null;

  timestamp: string;

  read: boolean;

  href?: string | null;

  metadata?: Record<string, unknown>;
}

export interface NotificationResponse {
  notifications: Notification[];

  unreadCount: number;

  nextCursor: string | null;
}

export interface NotificationInboxItem {
  id: string;

  template_code: string;

  body: string;

  created_at: string;

  read_at: string | null;
}

export interface NotificationInboxPage {
  items: NotificationInboxItem[];

  next_cursor: string | null;

  unread: number;
}

export interface NotificationPreferences {
  locale: string;

  sms_enabled: boolean;

  email_enabled: boolean;

  push_enabled: boolean;

  nudges_enabled: boolean;
}

export type NotificationPreferenceChanges = Partial<
  Pick<
    NotificationPreferences,
    "locale" | "sms_enabled" | "email_enabled" | "push_enabled" | "nudges_enabled"
  >
>;