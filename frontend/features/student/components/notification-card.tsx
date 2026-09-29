"use client";

import type { ReactNode } from "react";
import {
  Bell,
  BriefcaseBusiness,
  Eye,
  Receipt,
  ShieldCheck,
} from "lucide-react";

import type {
  Notification,
  NotificationType,
} from "@/features/notifications";

import { interactiveCardClass } from "./primitives";

/*
 * ==========================================================================
 * NOTIFICATION CARD
 *
 * Tapping an unread card delegates to the inbox API owner.
 * ==========================================================================
 */

const ICONS: Record<NotificationType, ReactNode> = {
  STUDENT_LINKED: <Eye size={20} className="text-[#5E4DB2]" />,
  CONSENT_PENDING: <ShieldCheck size={20} className="text-[#0A1931]" />,
  PAYMENT: <Receipt size={20} className="text-[#0A1931]" />,
  ROSTER: <BriefcaseBusiness size={20} className="text-[#0A1931]" />,
  HIRING: <BriefcaseBusiness size={20} className="text-[#0A1931]" />,
  JOB: <BriefcaseBusiness size={20} className="text-[#0A1931]" />,
  SECURITY: <ShieldCheck size={20} className="text-[#0A1931]" />,
  SYSTEM: <Bell size={20} className="text-[#0A1931]" />,
};

function headingFor(templateCode: string): string {
  const headings: Record<string, string> = {
    IN_APP_APPLICATION_SENT: "Application sent",
    IN_APP_APPLICATION_UPDATE: "Application update",
    IN_APP_PAYMENT_RECEIVED: "Payment received",
    IN_APP_PAYMENT_FAILED: "Payment failed",
    IN_APP_ACCESS_ENDED: "Access ended",
    IN_APP_PRE_DEBIT: "Upcoming payment",
    IN_APP_KYB_APPROVED: "Organisation verified",
    IN_APP_KYB_NEEDS_INFO: "Verification update",
    IN_APP_INTERVIEW_FEEDBACK_READY: "Interview feedback ready",
    IN_APP_COLLEGE_STUDENT_DISCONNECTED: "College connection update",
    IN_APP_COLLEGE_STUDENT_STOPPED_SHARING: "Sharing update",
    IN_APP_DISPUTE_ANSWERED: "Dispute answered",
    IN_APP_PROFILE_INCOMPLETE: "Complete your profile",
  };
  return headings[templateCode] ?? "BharatPath update";
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";

  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function NotificationCard({
  notification,
  onRead,
}: {
  notification: Notification;
  onRead: (notification: Notification) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onRead(notification)}
      className={`flex w-full items-start gap-3 rounded-2xl border border-[#E7E0D4] bg-white p-4 text-left hover:bg-[#FFFDF9] ${interactiveCardClass}`}
    >
      <span className="mt-0.5 shrink-0">{ICONS[notification.type]}</span>

      <span className="flex flex-1 flex-col gap-1">
        <span className="flex items-center gap-2">
          <span className="text-[14px] font-semibold leading-5 text-[#0A1931]">
            {headingFor(notification.templateCode)}
          </span>
          {!notification.read ? (
            <span
              aria-label="Unread"
              className="h-2 w-2 shrink-0 rounded-full bg-[#B23A1E]"
            />
          ) : null}
        </span>
        <span className="text-[13px] leading-[18px] text-[#5F6B80]">
          {notification.title}
        </span>
        <span className="text-[11px] leading-4 text-[#9AA3B2]">
          {formatTime(notification.timestamp)}
        </span>
      </span>
    </button>
  );
}
