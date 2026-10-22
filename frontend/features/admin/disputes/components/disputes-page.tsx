"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { usePageHeader } from "@/components/layout/header-context";
import { Skeleton } from "@/components/common/loading";
import { ErrorState } from "@/components/ui";
import { useAppDispatch } from "@/store/hooks";
import { closeDispute, openDispute as openDisputeAction, setDisputeTab } from "@/store/admin/disputes/slice";

import { useDisputes } from "../hooks/use-disputes";

import { ClosedDisputesTab } from "./closed-disputes-tab";
import { DisputeDrawer } from "./dispute-drawer";
import { OpenDisputesTab } from "./open-disputes-tab";

export function DisputesPage() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const requestedReview = searchParams.get("review");
  useEffect(() => {
    if (requestedTab === "open" || requestedTab === "resolved" || requestedTab === "rejected") {
      dispatch(setDisputeTab(requestedTab));
    }
    if (requestedReview) {
      dispatch(openDisputeAction(requestedReview));
    } else {
      dispatch(closeDispute());
    }
  }, [dispatch, requestedTab, requestedReview]);

  usePageHeader(
    "Disputes",
    "Investigate and resolve disputes raised by candidates, employers and colleges",
  );

  const {
    state,
    filterControls,
    openDisputes,
    resolvedDisputes,
    rejectedDisputes,
    openLoading,
    resolvedLoading,
    rejectedLoading,
    disputeError,
    retryDisputes,
    openCount,
    openHasMore,
    openPagination,
    resolvedCount,
    resolvedHasMore,
    resolvedPagination,
    rejectedCount,
    rejectedHasMore,
    rejectedPagination,
    setTab,
    openDispute,
  } = useDisputes();

  return (
    <>
      <div className="min-w-0 space-y-0">
        {filterControls}
        {/* ============================================================
            TABS
            ============================================================ */}

        <div className="border-b border-[#e7e9ee]">
          <div className="flex items-center gap-1">
            {(
              [
                ["open", "Open", openCount, openHasMore, openLoading],
                [
                  "resolved",
                  "Resolved",
                  resolvedCount,
                  resolvedHasMore,
                  resolvedLoading,
                ],
                [
                  "rejected",
                  "Rejected",
                  rejectedCount,
                  rejectedHasMore,
                  rejectedLoading,
                ],
              ] as const
            ).map(([tab, label, count, hasMore, countLoading]) => {
              const active =
                state.tab === tab;

              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() =>
                    setTab(tab)
                  }
                  className={[
                    "relative shrink-0 cursor-pointer px-4 py-3",
                    "text-[13px] font-semibold transition-colors",
                    active
                      ? "text-[#172033]"
                      : "text-[#687182] hover:text-[#172033]",
                  ].join(" ")}
                >
                  <span className="inline-flex items-center gap-1">
                    {label} ·{" "}
                    {countLoading ? (
                      <Skeleton width={18} height={12} radius={4} />
                    ) : (
                      `${count}${hasMore ? "+" : ""}`
                    )}
                  </span>

                  {active && (
                    <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#315c9f]" />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ============================================================
            CONTENT
            ============================================================ */}

        <div className="min-w-0 pt-4">
          {/* ==========================================================
              DISPUTES
              ========================================================== */}

          <div className="min-w-0">
            {disputeError ? (
              <ErrorState
                error={disputeError}
                fallback="Could not load disputes."
                onRetry={retryDisputes}
                className="mb-3"
              />
            ) : null}
            {state.tab === "open" && (
              <OpenDisputesTab
                disputes={openDisputes}
                onOpen={(id) => {
                  openDispute(id);
                  router.replace(`/admin/disputes?tab=open&review=${encodeURIComponent(id)}`, { scroll: false });
                }}
                isLoading={openLoading}
                pagination={openPagination}
              />
            )}

            {state.tab === "resolved" && (
              <ClosedDisputesTab
                disputes={resolvedDisputes}
                onOpen={(id) => {
                  openDispute(id);
                  router.replace(`/admin/disputes?tab=resolved&review=${encodeURIComponent(id)}`, { scroll: false });
                }}
                isLoading={resolvedLoading}
                pagination={resolvedPagination}
                emptyTitle="No resolved disputes"
              />
            )}

            {state.tab === "rejected" && (
              <ClosedDisputesTab
                disputes={rejectedDisputes}
                onOpen={(id) => {
                  openDispute(id);
                  router.replace(`/admin/disputes?tab=rejected&review=${encodeURIComponent(id)}`, { scroll: false });
                }}
                isLoading={rejectedLoading}
                pagination={rejectedPagination}
                emptyTitle="No rejected disputes"
              />
            )}
          </div>
        </div>
      </div>

      {/* ==============================================================
          DRAWER
          ============================================================== */}

      <DisputeDrawer />
    </>
  );
}

export const AdminDisputesPage =
  DisputesPage;
