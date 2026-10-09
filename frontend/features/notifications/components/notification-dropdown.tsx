"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  BriefcaseBusiness,
  Clock3,
  Link2,
  LoaderCircle,
  Receipt,
  ShieldCheck,
  Upload,
  X,
} from "lucide-react";

import {
  useGetNotificationsQuery,
  useLazyGetNotificationsQuery,
  useMarkNotificationReadMutation,
} from "@/store/api/notification-api";

import { useAppDispatch } from "@/store/hooks";
import { closeNotifications } from "@/store/common/slices/notification-slice";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import type {
  Notification,
  NotificationType,
} from "../types/notification.types";

const PAGE_SIZE = 10;
const DISMISSED_NOTIFICATIONS_KEY = "bharatpath-dismissed-notifications";

function mergeNotifications(
  current: Notification[],
  incoming: Notification[],
): Notification[] {
  const byId = new Map(current.map((notification) => [notification.id, notification]));
  incoming.forEach((notification) => {
    byId.set(notification.id, notification);
  });
  return Array.from(byId.values()).sort(
    (left, right) =>
      new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime(),
  );
}

function persistDismissedNotifications(ids: Set<string>) {
  try {
    localStorage.setItem(
      DISMISSED_NOTIFICATIONS_KEY,
      JSON.stringify(Array.from(ids).slice(-500)),
    );
  } catch {
    // Storage can be unavailable in private browsing; dismissal still works in memory.
  }
}

function initialDismissedNotifications(): Set<string> {
  if (typeof window === "undefined") return new Set();

  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(DISMISSED_NOTIFICATIONS_KEY) ?? "[]",
    );
    return Array.isArray(stored)
      ? new Set(stored.filter((id): id is string => typeof id === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function getNotificationIcon(type: NotificationType) {
  switch (type) {
    case "STUDENT_LINKED":
      return Link2;

    case "CONSENT_PENDING":
      return Clock3;

    case "PAYMENT":
      return Receipt;

    case "ROSTER":
      return Upload;

    case "HIRING":
    case "JOB":
      return BriefcaseBusiness;

    case "SECURITY":
      return ShieldCheck;

    default:
      return Bell;
  }
}

function getIconStyles(type: NotificationType): {
  background: string;
  color: string;
} {
  switch (type) {
    case "STUDENT_LINKED":
      return { background: "var(--indigo-bg)", color: "var(--indigo)" };

    case "CONSENT_PENDING":
      return { background: "var(--amber-bg)", color: "var(--amber-ink)" };

    case "PAYMENT":
      return { background: "var(--green-bg)", color: "var(--green-ink)" };

    case "ROSTER":
      return { background: "var(--indigo-bg)", color: "var(--indigo)" };

    case "HIRING":
    case "JOB":
      return { background: "var(--green-bg)", color: "var(--green-ink)" };

    case "SECURITY":
      return { background: "#fceeee", color: "#b42318" };

    default:
      return { background: "var(--indigo-bg)", color: "var(--indigo)" };
  }
}

function formatTime(timestamp: string) {
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const difference = Date.now() - date.getTime();

  const minutes = Math.floor(difference / 60_000);
  if (minutes < 60) {
    return `${Math.max(minutes, 1)}m ago`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d ago`;
  }

  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function NotificationDropdown() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const [additionalNotifications, setAdditionalNotifications] = useState<
    Notification[]
  >([]);
  const [readNotificationIds, setReadNotificationIds] = useState<Set<string>>(
    new Set(),
  );
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(
    initialDismissedNotifications,
  );
  const [nextCursorOverride, setNextCursorOverride] = useState<
    string | null | undefined
  >(undefined);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [isMarkingAllRead, setIsMarkingAllRead] = useState(false);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        const bell = (event.target as HTMLElement)?.closest(
          'button[aria-label="Notifications"]',
        );
        if (!bell) {
          dispatch(closeNotifications());
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [dispatch]);

  const { data, isLoading, isError } = useGetNotificationsQuery({
    limit: PAGE_SIZE,
  });
  const [getNotifications] = useLazyGetNotificationsQuery();

  const [markNotificationRead] = useMarkNotificationReadMutation();

  const notifications = mergeNotifications(
    data?.notifications ?? [],
    additionalNotifications,
  ).map((notification) =>
    readNotificationIds.has(notification.id)
      ? { ...notification, read: true }
      : notification,
  );
  const nextCursor =
    nextCursorOverride === undefined
      ? data?.nextCursor ?? null
      : nextCursorOverride;

  const visibleNotifications = notifications.filter(
    (notification) => !dismissedIds.has(notification.id),
  );
  const unreadCount = visibleNotifications.filter(
    (notification) => !notification.read,
  ).length;

  const close = () => {
    dispatch(closeNotifications());
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (notification.read) {
      if (notification.href) {
        close();
        router.push(notification.href);
      }
      return;
    }

    setReadNotificationIds((current) =>
      new Set(current).add(notification.id),
    );

    try {
      await markNotificationRead(notification.id).unwrap();

      if (notification.href) {
        close();
        router.push(notification.href);
      }
    } catch (error) {
      setReadNotificationIds((current) => {
        const updated = new Set(current);
        updated.delete(notification.id);
        return updated;
      });
      console.error("Failed to mark notification as read:", error);
    }
  };

  const handleMarkAllRead = async () => {
    if (isMarkingAllRead) return;

    setIsMarkingAllRead(true);

    try {
      let allNotifications = notifications;
      let cursor = nextCursor;

      while (cursor) {
        const page = await getNotifications({
          limit: 100,
          cursor,
        }).unwrap();
        allNotifications = mergeNotifications(
          allNotifications,
          page.notifications,
        );
        cursor = page.nextCursor;
      }

      setAdditionalNotifications(allNotifications);
      setReadNotificationIds(
        new Set(allNotifications.map((notification) => notification.id)),
      );
      setNextCursorOverride(null);

      await Promise.all(
        allNotifications
          .filter((notification) => !notification.read)
          .map((notification) =>
            markNotificationRead(notification.id).unwrap(),
          ),
      );
      showSuccessFeedback("All notifications marked as read.");
    } catch (error) {
      console.error(
        "Failed to mark all notifications as read:",
        error,
      );
    } finally {
      setIsMarkingAllRead(false);
    }
  };

  const handleDelete = async (
    event: React.MouseEvent,
    notificationId: string,
  ) => {
    event.stopPropagation();

    const notification = notifications.find((item) => item.id === notificationId);
    const updatedDismissedIds = new Set(dismissedIds).add(notificationId);
    setDismissedIds(updatedDismissedIds);
    persistDismissedNotifications(updatedDismissedIds);
    showSuccessFeedback("Notification dismissed.");

    if (notification && !notification.read) {
      try {
        await markNotificationRead(notificationId).unwrap();
      } catch (error) {
        console.error("Failed to mark dismissed notification as read:", error);
      }
    }
  };

  const loadMoreNotifications = async () => {
    if (!nextCursor || loadingMoreRef.current) return;

    loadingMoreRef.current = true;
    setIsLoadingMore(true);
    setLoadMoreFailed(false);

    try {
      const page = await getNotifications({
        limit: PAGE_SIZE,
        cursor: nextCursor,
      }).unwrap();
      setAdditionalNotifications((current) =>
        mergeNotifications(current, page.notifications),
      );
      setNextCursorOverride(page.nextCursor);
    } catch (error) {
      setLoadMoreFailed(true);
      console.error("Failed to load more notifications:", error);
    } finally {
      loadingMoreRef.current = false;
      setIsLoadingMore(false);
    }
  };

  const loadMoreFromObserver = useEffectEvent(loadMoreNotifications);

  useEffect(() => {
    const root = scrollContainerRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel || !nextCursor) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          void loadMoreFromObserver();
        }
      },
      { root, rootMargin: "48px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [nextCursor]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute",
        right: 0,
        top: 44,
        width: "min(320px, calc(100vw - 32px))",
        background: "rgb(255, 255, 255)",
        border: "1px solid var(--border-card)",
        borderRadius: 12,
        boxShadow: "rgba(19, 26, 38, 0.28) 0px 12px 28px -14px",
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 0,
        zIndex: 30,
        animation: "0.15s ease 0s 1 normal both running bpFadeUp",
      }}
    >
      {/* HEADER */}
      <span
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 8px 6px",
        }}
      >
        <span
          style={{
            font: '700 10px / 13px "General Sans", sans-serif',
            letterSpacing: "0.14em",
            color: "var(--ink-muted)",
          }}
        >
          NOTIFICATIONS
        </span>

        {unreadCount > 0 && (
          <span
            role="button"
            tabIndex={0}
            onClick={handleMarkAllRead}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleMarkAllRead();
              }
            }}
            style={{
              font: '600 11px / 14px "General Sans", sans-serif',
              color: "var(--indigo)",
              cursor: isMarkingAllRead ? "default" : "pointer",
              opacity: isMarkingAllRead ? 0.6 : 1,
            }}
          >
            {isMarkingAllRead ? "Marking..." : "Mark all as read"}
          </span>
        )}
      </span>

      {/* BODY */}
      <div
        ref={scrollContainerRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          maxHeight: 208,
          overflowY: "auto",
          overflowX: "hidden",
          overscrollBehavior: "contain",
        }}
        className="bp-scrollbar"
      >
        {isLoading && (
          <div aria-label="Loading notifications" style={{ padding: "4px 0" }}>
            {[0, 1, 2].map((index) => (
              <div
                key={index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 8px",
                }}
              >
                <span
                  className="bp-skeleton"
                  style={{ width: 32, height: 32, borderRadius: 8, flex: "0 0 auto" }}
                />
                <span style={{ display: "flex", flex: 1, flexDirection: "column", gap: 7 }}>
                  <span
                    className="bp-skeleton"
                    style={{ width: `${78 - index * 9}%`, height: 10, borderRadius: 4 }}
                  />
                  <span
                    className="bp-skeleton"
                    style={{ width: 48, height: 8, borderRadius: 4 }}
                  />
                </span>
              </div>
            ))}
          </div>
        )}

        {isError && notifications.length === 0 && (
          <div style={{ padding: "24px 8px", textAlign: "center" }}>
            <p
              style={{
                font: '500 12px / 16px "General Sans", sans-serif',
                color: "var(--navy)",
              }}
            >
              Unable to load notifications
            </p>
          </div>
        )}

        {!isLoading && !isError && visibleNotifications.length === 0 && (
          <div style={{ padding: "24px 8px", textAlign: "center" }}>
            <Bell
              size={20}
              style={{
                margin: "0 auto 6px",
                color: "var(--ink-muted)",
                opacity: 0.5,
              }}
            />
            <p
              style={{
                font: '500 12px / 16px "General Sans", sans-serif',
                color: "var(--navy)",
              }}
            >
              No notifications
            </p>
            <p
              style={{
                font: '400 11px / 14px "General Sans", sans-serif',
                color: "var(--ink-muted)",
                marginTop: 2,
              }}
            >
              You&apos;re all caught up.
            </p>
          </div>
        )}

        {visibleNotifications.map((notification, index) => {
          const Icon = getNotificationIcon(notification.type);
          const iconStyles = getIconStyles(notification.type);

          return (
            <div
              key={notification.id}
              role="button"
              tabIndex={0}
              aria-label={`${notification.read ? "Read" : "Unread"} notification: ${notification.title}`}
              className="transition-colors hover:bg-[#f8f9fb]"
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 8px",
                borderRadius: 8,
                borderTop:
                  index === 0
                    ? "none"
                    : "1px solid var(--border-hair)",
                cursor: "pointer",
                animation: "bpFadeUp 180ms ease both",
                animationDelay: `${Math.min(index, 6) * 24}ms`,
              }}
              onClick={() => handleNotificationClick(notification)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  void handleNotificationClick(notification);
                }
              }}
            >
              {/* ICON */}
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: iconStyles.background,
                  display: "grid",
                  placeItems: "center",
                  flex: "0 0 auto",
                }}
              >
                <Icon
                  size={14}
                  strokeWidth={2.2}
                  style={{ color: iconStyles.color }}
                />
              </span>

              {/* CONTENT */}
              <span
                style={{
                  flex: "1 1 0%",
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  paddingTop: 2,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    font: '500 12px / 16px "General Sans", sans-serif',
                    color: "var(--navy)",
                    wordBreak: "break-word",
                  }}
                >
                  {notification.title}
                </span>

                <span
                  style={{
                    font: '400 11px / 14px "General Sans", sans-serif',
                    color: "var(--ink-muted)",
                  }}
                >
                  {formatTime(notification.timestamp)}
                </span>
              </span>

              {/* UNREAD DOT */}
              {!notification.read && (
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--indigo)",
                    flex: "0 0 auto",
                    marginTop: 4,
                  }}
                />
              )}

              {/* CLEAR BUTTON */}
              <button
                type="button"
                aria-label="Delete notification"
                title="Delete notification"
                onClick={(event) =>
                  handleDelete(event, notification.id)
                }
                className="transition-colors hover:bg-[#f2f3f5]"
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 8,
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                  flex: "0 0 auto",
                }}
              >
                <X
                  size={12}
                  strokeWidth={2.2}
                  style={{ color: "var(--ink-muted)" }}
                />
              </button>
            </div>
          );
        })}

        <div ref={loadMoreSentinelRef} style={{ minHeight: nextCursor ? 1 : 0 }} />

        {isLoadingMore && (
          <div
            role="status"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              padding: "12px 8px",
              color: "var(--ink-muted)",
              font: '500 11px / 14px "General Sans", sans-serif',
            }}
          >
            <LoaderCircle className="animate-spin" size={14} aria-hidden="true" />
            Loading more
          </div>
        )}

        {loadMoreFailed && !isLoadingMore && (
          <button
            type="button"
            onClick={() => void loadMoreNotifications()}
            style={{
              alignSelf: "center",
              margin: "8px",
              color: "var(--indigo)",
              font: '600 11px / 14px "General Sans", sans-serif',
            }}
          >
            Couldn&apos;t load more. Try again
          </button>
        )}
      </div>
    </div>
  );
}
