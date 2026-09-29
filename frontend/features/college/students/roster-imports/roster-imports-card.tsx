"use client";

import React, { useState } from "react";
import {
  FileSpreadsheet,
  Eye,
  Send,
  Trash2,
  CheckCircle2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { Skeleton } from "@/components/common/loading";

import type {
  RosterImport,
  RosterImportState,
} from "@/store/college/roster-imports";
import { InfiniteScrollArea } from "../shared";

export interface RosterImportsCardProps {
  imports: RosterImport[];
  isLoading: boolean;
  isError: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMoreError: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onViewRows: (import_: RosterImport) => void;
  onCommit: (importId: string) => Promise<unknown>;
  isCommitting: boolean;
  onDiscard: (importId: string) => Promise<unknown>;
  isDiscarding: boolean;
  onSend: (importId: string) => Promise<unknown>;
  isSending: boolean;
}

const STATE_STYLES: Record<RosterImportState, string> = {
  PREVIEW: "bg-[#edf2fa] text-[#3566b8]",
  COMMITTED: "bg-[#eaf5ef] text-[#23805d]",
  DISCARDED: "bg-[#f0f2f5] text-[#717a8a]",
};

function StateBadge({ state }: { state: RosterImportState }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATE_STYLES[state]}`}
    >
      {state.charAt(0) + state.slice(1).toLowerCase()}
    </span>
  );
}

export function RosterImportsCard({
  imports,
  isLoading,
  isError,
  hasMore,
  isLoadingMore,
  loadMoreError,
  onLoadMore,
  onRetry,
  onViewRows,
  onCommit,
  isCommitting,
  onDiscard,
  isDiscarding,
  onSend,
  isSending,
}: RosterImportsCardProps) {
  /* The clicked row, so only its button spins while a global flag is set. */
  const [actingId, setActingId] = useState<string | null>(null);
  const [pendingDiscard, setPendingDiscard] = useState<RosterImport | null>(
    null,
  );

  const run = async (
    id: string,
    action: (id: string) => Promise<unknown>,
  ) => {
    setActingId(id);
    try {
      await action(id);
    } finally {
      setActingId(null);
    }
  };

  const confirmDiscard = async () => {
    if (!pendingDiscard) return;
    await run(pendingDiscard.id, onDiscard);
    setPendingDiscard(null);
  };

  return (
    <div
      id="roster-imports"
      className="scroll-mt-4 rounded-2xl border border-[#e7e9ee] bg-white p-6 shadow-2xs"
    >
      <div className="flex items-center gap-2.5 mb-4">
        <div className="grid h-9 w-9 place-items-center rounded-xl bg-[#edf2fa] text-[#5b4fcf]">
          <FileSpreadsheet size={18} strokeWidth={2.2} />
        </div>
        <div>
          <h3 className="text-[16px] font-bold text-[#151b2b] tracking-[-0.01em]">
            Roster imports
          </h3>
          <p className="text-[12px] text-[#777f90]">
            Review, commit and send invitations for uploaded rosters
          </p>
        </div>
      </div>

      {isLoading && imports.length === 0 ? (
        <div className="space-y-2.5">
          <Skeleton className="h-20 w-full" radius={12} />
          <Skeleton className="h-20 w-full" radius={12} />
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="rounded-xl border border-[#f3d6d6] bg-[#fdf2f2] px-4 py-5 text-center"
        >
          <p className="text-[13px] text-[#9d2d2d]">
            Roster imports could not be loaded.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 text-[12px] font-semibold text-[#3566b8] hover:underline"
          >
            Retry
          </button>
        </div>
      ) : imports.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[#dfe2e8] bg-[#fcfdfe] px-4 py-6 text-center text-[13px] text-[#777f90]">
          No roster imports yet. Upload a CSV to preview and invite students.
        </p>
      ) : (
        <InfiniteScrollArea
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          loadError={loadMoreError}
          onLoadMore={onLoadMore}
          ariaLabel="Roster imports"
        >
          <ul className="space-y-3">
            {imports.map((import_) => {
              const busy = actingId === import_.id;
              const pendingInvites = import_.invitations.pending;

              return (
                <li
                  key={import_.id}
                  className="rounded-xl border border-[#e7e9ee] px-4 py-3"
                >
                  <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-[#151b2b]">
                          {import_.fileName}
                        </span>
                        <StateBadge state={import_.state} />
                      </div>
                      <p className="mt-0.5 text-[12px] text-[#777f90]">
                        {import_.validRows} valid • {import_.invalidRows} invalid
                        • {import_.duplicateRows} duplicate of {import_.totalRows}
                      </p>
                      {import_.state === "COMMITTED" && (
                        <p className="mt-0.5 text-[12px] text-[#23805d]">
                          {import_.invitations.sent} sent •{" "}
                          {import_.invitations.accepted} accepted •{" "}
                          {pendingInvites} pending
                        </p>
                      )}
                    </div>

                    <div className="flex w-full shrink-0 flex-wrap items-center justify-start gap-1.5 xl:w-auto xl:justify-end">
                      {import_.state !== "DISCARDED" && (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          icon={<Eye size={14} />}
                          className="!px-2"
                          onClick={() => onViewRows(import_)}
                        >
                          Preview
                        </Button>
                      )}

                      {import_.state === "PREVIEW" && (
                        <>
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            icon={<CheckCircle2 size={14} />}
                            className="!px-2"
                            isLoading={busy && isCommitting}
                            disabled={busy}
                            onClick={() => run(import_.id, onCommit)}
                          >
                            Commit
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            icon={<Trash2 size={14} />}
                            className="!px-2"
                            disabled={busy}
                            onClick={() => setPendingDiscard(import_)}
                          >
                            Discard
                          </Button>
                        </>
                      )}

                      {import_.state === "COMMITTED" &&
                        pendingInvites > 0 && (
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            icon={<Send size={14} />}
                            isLoading={busy && isSending}
                            disabled={busy}
                            onClick={() => run(import_.id, onSend)}
                          >
                            Send invites
                          </Button>
                        )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </InfiniteScrollArea>
      )}

      <ConfirmModal
        open={pendingDiscard !== null}
        title="Discard this import?"
        description="The preview is thrown away and no invitations are created. This cannot be undone."
        confirmLabel="Discard import"
        confirmLoading={isDiscarding}
        onClose={() => setPendingDiscard(null)}
        onConfirm={confirmDiscard}
      />
    </div>
  );
}
