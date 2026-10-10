import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";

import { getFreshToken } from "@/lib/auth/refresh-session";

import type {
  Notification,
  NotificationInboxItem,
  NotificationInboxPage,
  NotificationPreferenceChanges,
  NotificationPreferences,
  NotificationResponse,
  NotificationType,
} from "@/features/notifications/types/notification.types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "https://bharatpath-api.duckdns.org/api/v1";

function notificationType(templateCode: string): NotificationType {
  if (templateCode.includes("SHORTLIST_INVITED")) return "JOB";
  if (templateCode.includes("APPLICATION")) return "HIRING";
  if (templateCode.includes("PAYMENT") || templateCode.includes("DEBIT")) {
    return "PAYMENT";
  }
  if (templateCode.includes("COLLEGE_STUDENT")) return "STUDENT_LINKED";
  if (templateCode.includes("KYB") || templateCode.includes("DISPUTE")) {
    return "SECURITY";
  }
  if (templateCode.includes("INTERVIEW")) return "JOB";
  return "SYSTEM";
}

function toNotification(item: NotificationInboxItem): Notification {
  return {
    id: item.id,
    templateCode: item.template_code,
    type: notificationType(item.template_code),
    title: item.body,
    timestamp: item.created_at,
    read: item.read_at !== null,
    href: notificationHref(item.template_code),
  };
}

/** Where tapping a notification goes, for the templates that have a destination. */
function notificationHref(templateCode: string): string | undefined {
  switch (templateCode) {
    case "IN_APP_SHORTLIST_INVITED":
      return "/student/invites";
    // Staff: a new or corrected verification is waiting in the KYB queue.
    case "IN_APP_KYB_SUBMITTED":
    case "IN_APP_KYB_RESUBMITTED":
      return "/admin/queue?tab=kyb";
    // Owner: sent back or rejected, the fix happens on the verification page.
    case "IN_APP_KYB_NEEDS_INFO":
    case "IN_APP_KYB_REJECTED":
      return "/employer/settings";
    default:
      return undefined;
  }
}

const rawBaseQuery = fetchBaseQuery({
  baseUrl: API_BASE_URL,

  credentials: "include",

  prepareHeaders: async (headers) => {
    headers.set("Accept", "application/json");

    const bearerToken =
      (await getFreshToken()) ?? process.env.NEXT_PUBLIC_API_BEARER_TOKEN;
    if (bearerToken) {
      headers.set("Authorization", `Bearer ${bearerToken}`);
    }

    return headers;
  },
});

export const notificationApi = createApi({
  reducerPath: "notificationApi",

  baseQuery: rawBaseQuery,

  tagTypes: ["Notifications", "NotificationPreferences"],

  endpoints: (builder) => ({
    getNotifications: builder.query<
      NotificationResponse,
      {
        limit?: number;
        cursor?: string;
      }
    >({
      query: ({ limit = 10, cursor } = {}) => ({
        url: "/notifications",
        method: "GET",
        params: {
          limit,
          ...(cursor ? { cursor } : {}),
        },
      }),

      transformResponse: (response: NotificationInboxPage): NotificationResponse => ({
        notifications: response.items.map(toNotification),
        unreadCount: response.unread,
        nextCursor: response.next_cursor,
      }),

      providesTags: ["Notifications"],
    }),

    markNotificationRead: builder.mutation<
      Notification,
      string
    >({
      query: (notificationId) => ({
        url: `/notifications/${notificationId}/read`,
        method: "POST",
      }),

      transformResponse: (response: NotificationInboxItem) =>
        toNotification(response),

      invalidatesTags: ["Notifications"],
    }),

    getNotificationPreferences: builder.query<NotificationPreferences, void>({
      query: () => ({
        url: "/notifications/preferences",
        method: "GET",
      }),

      providesTags: ["NotificationPreferences"],
    }),

    updateNotificationPreferences: builder.mutation<
      NotificationPreferences,
      NotificationPreferenceChanges
    >({
      query: (changes) => ({
        url: "/notifications/preferences",
        method: "PATCH",
        body: changes,
      }),

      invalidatesTags: ["NotificationPreferences"],
    }),
  }),
});

export const {
  useGetNotificationsQuery,
  useGetNotificationPreferencesQuery,
  useLazyGetNotificationsQuery,
  useMarkNotificationReadMutation,
  useUpdateNotificationPreferencesMutation,
} = notificationApi;
