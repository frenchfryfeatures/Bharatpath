"use client";

import { useRef, useState } from "react";
import { CircleAlert } from "lucide-react";
import { ConfirmModal } from "@/components/ui";
import { getApiErrorMessage } from "@/lib/api/error-message";

import { humanizeCode } from "@/lib/format/labels";

export function CancelSubscriptionDialog({ open, planCode, periodEnd, onCancel, onClose, student = false }: {
  open: boolean;
  planCode?: string | null;
  periodEnd?: string | null;
  onCancel: () => Promise<unknown>;
  onClose: () => void;
  student?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  const endDate = periodEnd ? new Date(periodEnd).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;

  const close = () => {
    if (pending.current) return;
    setError(null);
    onClose();
  };

  const cancel = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      await onCancel();
      onClose();
    } catch (cause) {
      setError(getApiErrorMessage(cause, "Subscription cancellation failed. Please try again."));
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
  >
    {error ? <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p> : null}
  </ConfirmModal>;
}
