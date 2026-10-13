"use client";

import { useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { ConfirmModal } from "@/components/ui";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { showFormError } from "@/lib/feedback/form-error";

import { humanizeCode } from "@/lib/format/labels";

export function CancelSubscriptionDialog({ open, planCode, periodEnd, onCancel, onClose, student = false, portal = "employer" }: {
  open: boolean;
  planCode?: string | null;
  periodEnd?: string | null;
  onCancel: () => Promise<unknown>;
  onClose: () => void;
  student?: boolean;
  portal?: "employer" | "college";
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const endDate = periodEnd ? new Date(periodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;

  const close = () => {
    if (pending.current) return;
    onClose();
  };

  const cancel = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      await onCancel();
      onClose();
    } catch (cause) {
      showFormError(getApiErrorMessage(cause, "Subscription cancellation failed. Please try again."), { portal: student ? "student" : portal });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return <ConfirmModal
    open={open}
    variant={student ? "student" : "default"}
    title="Cancel subscription?"
    description={`Cancel renewal${planCode ? ` for ${humanizeCode(planCode)}` : ""}? Your paid access continues ${endDate ? `until ${endDate}` : "until the end of the current billing period"}. Your subscription will not renew automatically. This does not issue a refund.`}
    confirmLabel="Cancel subscription"
    cancelLabel="Keep subscription"
    tone="danger"
    icon={<CircleAlert size={18} />}
    confirmLoading={busy}
    onClose={close}
    onConfirm={() => void cancel()}
  />;
}
