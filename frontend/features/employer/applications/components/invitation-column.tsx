"use client";

import { useCallback } from "react";
import { useCursorLoadMore } from "@/lib/pagination/use-cursor-load-more";
import { useLazyGetEmployerInvitationsQuery } from "@/store/shortlist/shortlist.api";
import { EmployerErrorState } from "@/features/employer/components/employer-error-state";

export function InvitationColumn({ status, jobId }: { status: "INVITED" | "DECLINED"; jobId?: string }) {
  const [load] = useLazyGetEmployerInvitationsQuery();
  const pages = useCursorLoadMore(useCallback(async (cursor: string | undefined) => {
    const page = await load({ status, job_id: jobId, cursor, limit: 20 }).unwrap();
    return { items: page.items, nextCursor: page.next_cursor };
  }, [load, status, jobId]), [status, jobId]);
  return <section className="flex h-full w-[280px] shrink-0 flex-col rounded-xl border border-[#e5e8ee] bg-[#f1f3f7]">
    <header className="flex items-center justify-between gap-2 border-b border-[#e5e8ee] p-3"><h2 className="text-[13px] font-bold text-[#273142]">{status === "INVITED" ? "Invitation" : "Invitation rejected"} <span className="text-[#687182]">{pages.items.length}{pages.hasMore ? "+" : ""}</span></h2><button type="button" onClick={pages.retry} disabled={pages.isLoading} className="text-[11px] font-semibold text-[#51449a]">Refresh</button></header>
    <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
      {pages.isLoading ? <p role="status" className="text-xs text-[#687182]">Loading invitations...</p> : null}
      {pages.error ? <EmployerErrorState error={pages.error} onRetry={pages.retry} /> : null}
      {!pages.isLoading && !pages.error && pages.items.length === 0 ? <p className="py-6 text-center text-xs text-[#687182]">{status === "INVITED" ? "No pending invitations" : "No rejected invitations"}</p> : null}
      {pages.items.map((invitation) => <article key={invitation.id} className="space-y-2 rounded-lg border border-[#e5e8ee] bg-white p-3"><h3 className="text-[13px] font-semibold text-[#273142]">{invitation.candidate?.full_name ?? "Candidate unavailable"}</h3><p className="text-xs text-[#687182]">{invitation.job_title ?? "Job unavailable"}</p><p className="text-[11px] text-[#51449a]">{status === "INVITED" ? "Awaiting candidate response" : "Rejected by candidate"}</p><p className="text-[11px] text-[#687182]">{new Date(invitation.created_at).toLocaleDateString("en-IN")}</p></article>)}
      {pages.hasMore ? <button type="button" onClick={pages.loadMore} disabled={pages.isLoadingMore} className="w-full rounded-lg border border-[#d9dee7] bg-white p-2 text-xs text-[#51449a]">{pages.isLoadingMore ? "Loading..." : "Load more"}</button> : null}
    </div>
  </section>;
}
