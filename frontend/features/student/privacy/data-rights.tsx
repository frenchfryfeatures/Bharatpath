"use client";

import { useState } from "react";
import { FileDown, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";

import {
  PillButton,
  StatusChip,
  StudentCard,
  StudentErrorState,
  type ChipTone,
} from "@/features/student/components";
import { formatDate, formatDateTime } from "@/features/student/formatters";
import { Skeleton } from "@/components/common/loading";
import {
  useGetPrivacyRequestsQuery,
  useRequestPrivacyExportMutation,
  useRequestPrivacyDeletionMutation,
  useWithdrawPrivacyRequestMutation,
  useGetPrivacyDownloadMutation,
  type PrivacyRequest,
} from "@/store/api/privacy-api";

/* `dsr_states` on the backend: RECEIVED, PROCESSING, COMPLETED, REJECTED. */
const TYPE_LABEL: Record<PrivacyRequest["type"], string> = {
  EXPORT: "Data export",
  DELETE: "Account deletion",
};

const STATE_LABEL: Record<string, string> = {
  RECEIVED: "Requested",
  PROCESSING: "In progress",
  COMPLETED: "Completed",
  REJECTED: "Declined",
};

const STATE_TONE: Record<string, ChipTone> = {
  RECEIVED: "waiting",
  PROCESSING: "short",
  COMPLETED: "paid",
  REJECTED: "neutral",
};

const linkButtonClass =
  "cursor-pointer text-[13px] font-semibold text-[#5F4DB2] underline underline-offset-2 transition-colors hover:text-[#4A3E8F] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30";

export function DataRights() {
  const requests = useGetPrivacyRequestsQuery();
  const [exportData, exporting] = useRequestPrivacyExportMutation();
  const [deleteData, deleting] = useRequestPrivacyDeletionMutation();
  const [withdraw] = useWithdrawPrivacyRequestMutation();
  const [download] = useGetPrivacyDownloadMutation();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [deletionOpen, setDeletionOpen] = useState(false);

  async function run(key: string, action: () => Promise<unknown>) {
    setError("");
    setBusy(key);
    try {
      await action();
    } catch {
      setError("Request could not be completed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <StudentCard padded={false} className="p-5">
      <div className="flex items-center gap-3">
        <FileDown size={20} className="shrink-0 text-[#5F4DB2]" />
        <span className="flex flex-1 flex-col">
          <span className="text-[15px] font-medium text-[#0A1931]">
            Your data
          </span>
          <span className="text-[12px] text-[#5F6B80]">
            Request a copy of your data or ask to delete your account.
          </span>
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <PillButton
          variant="secondary"
          className="px-4 py-2.5 text-[13px] leading-5"
          disabled={exporting.isLoading}
          onClick={() => void run("export", () => exportData().unwrap())}
        >
          {exporting.isLoading ? "Requesting…" : "Request export"}
        </PillButton>
        <button
          type="button"
          disabled={deleting.isLoading}
          onClick={() => { setError(""); setDeletionOpen(true); }}
          className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-full border border-[#EBC7BA] bg-[#F8E6E0] px-4 py-2.5 text-[13px] font-semibold leading-5 text-[#993A22] transition-all hover:bg-[#F1D9D1] active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#993A22]/30"
        >
          {deleting.isLoading ? "Requesting…" : "Request deletion"}
        </button>
      </div>

      {error && !deletionOpen ? (
        <StudentErrorState variant="inline" message={error} className="mt-3" />
      ) : null}

      <div className="mt-4 border-t border-[#F0EBDF] pt-4">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F6B80]">
          Your requests
        </span>

        {requests.isLoading ? (
          <div
            className="mt-3 flex flex-col gap-3"
            role="status"
            aria-busy="true"
          >
            <Skeleton width="100%" height={14} radius={6} />
            <Skeleton width="70%" height={14} radius={6} />
          </div>
        ) : requests.isError ? (
          <StudentErrorState
            variant="inline"
            error={requests.error}
            fallback="Your requests could not be loaded."
            onRetry={() => void requests.refetch()}
            className="mt-3"
          />
        ) : (requests.data?.items.length ?? 0) > 0 ? (
          <ul className="mt-1 divide-y divide-[#F0EBDF]">
            {requests.data?.items.map((request) => (
              <li
                key={request.id}
                className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13px] font-semibold text-[#0A1931]">
                      {TYPE_LABEL[request.type]}
                    </span>
                    <StatusChip
                      tone={STATE_TONE[request.state] ?? "neutral"}
                    >
                      {STATE_LABEL[request.state] ?? request.state}
                    </StatusChip>
                  </span>
                  <span className="shrink-0 text-[11px] text-[#5F6B80]">
                    Requested {formatDate(request.created_at)}
                  </span>
                </div>

                {request.erasable_at ? (
                  <p className="text-[11px] leading-4 text-[#5F6B80]">
                    Earliest erasure: {formatDateTime(request.erasable_at)}
                  </p>
                ) : null}

                {request.download_available ||
                (request.type === "DELETE" &&
                  request.state === "RECEIVED") ? (
                  <div className="flex flex-wrap gap-4">
                    {request.download_available ? (
                      <button
                        type="button"
                        disabled={busy === request.id}
                        onClick={() =>
                          void run(request.id, async () => {
                            const result = await download(request.id).unwrap();
                            window.open(result.url, "_blank", "noopener,noreferrer");
                          })
                        }
                        className={linkButtonClass}
                      >
                        Download export
                      </button>
                    ) : null}
                    {request.type === "DELETE" &&
                    request.state === "RECEIVED" ? (
                      <button
                        type="button"
                        disabled={busy === request.id}
                        onClick={() =>
                          void run(request.id, () => withdraw(request.id).unwrap())
                        }
                        className={linkButtonClass}
                      >
                        Withdraw deletion request
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[12px] leading-5 text-[#5F6B80]">
            You have not requested an export or a deletion yet.
          </p>
        )}
      </div>
      <Modal
        open={deletionOpen}
        variant="student"
        title="Request account deletion?"
        description="This requests deletion of your account and personal data. You can withdraw your request before the listed erasure time."
        onClose={() => setDeletionOpen(false)}
        closeDisabled={deleting.isLoading}
        panelClassName="max-w-[440px] rounded-[20px]"
      >
        <div className="mb-4 flex items-center gap-3 rounded-xl bg-[#F8E6E0] p-3 text-[13px] leading-5 text-[#993A22]">
          <Trash2 size={20} className="shrink-0" aria-hidden="true" />
          <p>Review your request carefully before continuing.</p>
        </div>
        {error ? <StudentErrorState variant="inline" message={error} className="mb-4" /> : null}
        <div className="flex justify-end gap-2">
          <PillButton variant="secondary" className="px-4 py-2.5 text-[13px]" disabled={deleting.isLoading} onClick={() => setDeletionOpen(false)}>Cancel</PillButton>
          <button
            type="button"
            disabled={deleting.isLoading}
            onClick={() => void run("delete", async () => { await deleteData().unwrap(); setDeletionOpen(false); })}
            className="rounded-full bg-[#993A22] px-4 py-2.5 text-[13px] font-semibold text-white transition hover:bg-[#7E2F1C] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#993A22]/40"
          >
            {deleting.isLoading ? "Requesting..." : "Request deletion"}
          </button>
        </div>
      </Modal>
    </StudentCard>
  );
}
