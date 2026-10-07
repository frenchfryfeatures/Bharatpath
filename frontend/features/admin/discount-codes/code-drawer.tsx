"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { ErrorState } from "@/components/ui";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { showAdminFeedback } from "@/store/admin";
import {
  type DiscountCode,
  useDisableAdminDiscountCodeMutation,
  useGetAdminDiscountRedemptionsQuery,
} from "@/store/api/admin-api";
import { useAppDispatch } from "@/store/hooks";

import { AUDIENCE_LABEL, formatDate, money, valueLabel } from "./format";

interface CodeDrawerProps {
  code: DiscountCode;
  canWrite: boolean;
  onClose: () => void;
}

export function CodeDrawer({ code, canWrite, onClose }: CodeDrawerProps) {
  useScrollLock(true);
  const dispatch = useAppDispatch();
  const redemptions = useGetAdminDiscountRedemptionsQuery({ id: code.id, limit: 50 });
  const [disableCode, disableState] = useDisableAdminDiscountCodeMutation();
  const [disableOpen, setDisableOpen] = useState(false);

  const disable = async () => {
    try {
      await disableCode(code.id).unwrap();
      setDisableOpen(false);
      dispatch(showAdminFeedback(`Discount code ${code.code} disabled.`));
    } catch {
      // Surfaced through `disableState.error` below.
    }
  };

  return (
    <div data-scroll-lock-root className="fixed inset-0 z-[100]">
      <button type="button" aria-label="Close details" onClick={onClose} className="absolute inset-0 bg-[#172033]/30" />
      <aside
        role="dialog"
        aria-modal="true"
        className="absolute right-0 top-0 flex h-full w-[520px] max-w-full flex-col bg-white shadow-[-20px_0_60px_-24px_rgba(0,0,0,0.5)]"
      >
        <header className="flex items-start justify-between border-b border-[#e5e7eb] px-5 py-4">
          <div>
            <h2 className="font-mono text-[18px] font-bold text-[#172033]">{code.code}</h2>
            <p className="mt-1 text-[12px] text-[#7b8494]">
              {AUDIENCE_LABEL[code.audience]} · {code.label || "No label"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-lg text-[#7b8494] hover:bg-[#f5f6f8]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 text-[13px]">
          <section className="grid grid-cols-2 gap-3 rounded-lg border border-[#e5e7eb] p-4">
            <Detail label="Discount" value={valueLabel(code)} />
            <Detail label="Status" value={code.status.charAt(0) + code.status.slice(1).toLowerCase()} />
            <Detail label="Usage" value={`${code.usage_count} / ${code.usage_limit ?? "Unlimited"}`} />
            <Detail label="Created" value={formatDate(code.created_at)} />
            <Detail label="Starts" value={formatDate(code.valid_from)} />
            <Detail label="Ends" value={code.valid_until ? formatDate(code.valid_until) : "No end date"} />
          </section>

          {disableState.error ? (
            <ErrorState error={disableState.error} fallback="The code could not be disabled." />
          ) : null}

          {canWrite && code.status !== "DISABLED" ? (
            <button
              type="button"
              disabled={disableState.isLoading}
              onClick={() => setDisableOpen(true)}
              className="w-full rounded-lg border border-[#c92f3f] px-4 py-3 text-[13px] font-semibold text-[#c92f3f] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {disableState.isLoading ? "Disabling…" : "Disable permanently"}
            </button>
          ) : null}

          <section>
            <h3 className="text-[13px] font-bold text-[#172033]">Successful redemptions</h3>
            <div className="mt-3 space-y-2">
              {redemptions.isLoading ? <p className="text-[12px] text-[#7b8494]">Loading redemptions…</p> : null}
              {redemptions.error ? (
                <ErrorState error={redemptions.error} fallback="Redemptions could not be loaded." />
              ) : null}
              {redemptions.data?.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-[#e5e7eb] p-3">
                  <div className="flex justify-between gap-3">
                    <strong className="truncate text-[#172033]">
                      {item.organisation || `Candidate ${item.user_id}`}
                    </strong>
                    <span className="shrink-0 text-[11px] text-[#7b8494]">{formatDate(item.redeemed_at)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-[#7b8494]">
                    Paid {money(item.amount_minor)} · saved {money(item.discount_minor)}
                  </p>
                </div>
              ))}
              {redemptions.data?.items.length === 0 ? (
                <p className="text-[12px] text-[#7b8494]">No successful redemptions yet.</p>
              ) : null}
            </div>
          </section>
        </div>
        <ConfirmModal
          open={disableOpen}
          title={`Disable ${code.code}?`}
          description="This discount code cannot be re-enabled."
          confirmLabel="Disable permanently"
          confirmLoading={disableState.isLoading}
          tone="danger"
          onClose={() => setDisableOpen(false)}
          onConfirm={() => void disable()}
        />
      </aside>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase text-[#7b8494]">{label}</p>
      <p className="mt-1 font-semibold text-[#172033]">{value}</p>
    </div>
  );
}
