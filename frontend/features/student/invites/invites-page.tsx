"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Mail } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Spinner } from "@/components/common/loading";
import { StudentPage } from "@/features/student/shell";
import { StudentErrorState } from "@/features/student/components/student-error-state";
import { EmptyState, MonogramTile, PillButton, StatusChip, type ChipTone } from "@/features/student/components/primitives";
import { employerMonogram, formatDate } from "@/features/student/formatters";
import { useCursorLoadMore } from "@/lib/pagination/use-cursor-load-more";
import { useLazyGetStudentInvitationsQuery, useAnswerStudentInvitationMutation, type Invitation, type InvitationStatus } from "@/store/shortlist/shortlist.api";

const filters = [
  { value: "all", label: "All" },
  { value: "INVITED", label: "Awaiting response" },
  { value: "ACCEPTED", label: "Accepted" },
  { value: "DECLINED", label: "Declined" },
  { value: "CANCELLED", label: "Cancelled" },
] as const;
const statusLabels: Record<InvitationStatus, string> = {
  INVITED: "Awaiting response", ACCEPTED: "Accepted", DECLINED: "Declined", CANCELLED: "Cancelled",
};
const statusTones: Record<InvitationStatus, ChipTone> = {
  INVITED: "short", ACCEPTED: "advanced", DECLINED: "neutral", CANCELLED: "neutral",
};
const linkClass = "inline-flex items-center rounded-full py-2 text-[13px] font-semibold text-[#5F4DB2] hover:text-[#4A3E8F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30";

export function InvitesPage() {
  const [filter, setFilter] = useState<"all" | InvitationStatus>("all");
  const [revision, setRevision] = useState(0);
  const [pendingAction, setPendingAction] = useState<{ id: string; action: "accept" | "decline" } | null>(null);
  const [result, setResult] = useState<Invitation | null>(null);
  const responding = useRef(false);
  const [load] = useLazyGetStudentInvitationsQuery();
  const [answer, actionState] = useAnswerStudentInvitationMutation();
  const pages = useCursorLoadMore(useCallback(async (cursor: string | undefined) => {
    const page = await load({ cursor, limit: 20, status: filter === "all" ? undefined : filter }).unwrap();
    return { items: page.items, nextCursor: page.next_cursor };
  }, [load, filter]), [filter, revision]);

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible" && !responding.current) setRevision((previous) => previous + 1);
    };
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, []);

  async function respond(id: string, action: "accept" | "decline") {
    if (responding.current) return;
    responding.current = true;
    setResult(null);
    try {
      const invitation = await answer({ id, action }).unwrap();
      setResult(invitation);
      setPendingAction(null);
      // Cache invalidation alone cannot update the cursor hook's accumulated items.
      setRevision((previous) => previous + 1);
    } catch {
      // Reload conflicting state while preserving the action error.
      setRevision((previous) => previous + 1);
    } finally {
      responding.current = false;
    }
  }

  return (
    <StudentPage>
      <div className="space-y-6">
        <p className="text-[13px] leading-5 text-[#5F6B80]">Employers have invited you to apply. Accept an invitation to add the application to your board at Shortlisted.</p>
        <div className="bp-scrollbar flex gap-2 overflow-x-auto pb-1" aria-label="Filter invitations">
          {filters.map((option) => (
          <button key={option.value} type="button" aria-pressed={filter === option.value} onClick={() => { setFilter(option.value); setPendingAction(null); }} className={`whitespace-nowrap rounded-full border px-3.5 py-2 text-[13px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/40 ${filter === option.value ? "border-[#C9BEEB] bg-[#F1EAF7] text-[#4A3E8F]" : "border-[#E7E0D4] bg-white text-[#5F6B80] hover:bg-[#F7F3EC]"}`}>
              {option.label}
            </button>
          ))}
        </div>
        {result ? (
          <div role="status" className="rounded-[16px] border border-[#E7E0D4] bg-[#F7F4EC] px-4 py-3 text-[13px] text-[#3A4761]">
            {result.status === "ACCEPTED" ? "Invitation accepted. Your application is on your board." : "Invitation declined. The employer cannot invite you to this job again."}
            {result.application_id ? <Link href={`/student/board/${result.application_id}`} className={`${linkClass} ml-2`}>View application</Link> : null}
          </div>
        ) : null}
        {actionState.error ? <StudentErrorState variant="inline" error={actionState.error} fallback="Could not respond to this invitation. Please try again." /> : null}
        {pages.error ? <StudentErrorState error={pages.error} title="Unable to load invites" onRetry={pages.retry} /> : null}
        {pages.isLoading ? (
          <div role="status" className="flex min-h-64 flex-col items-center justify-center gap-3 text-center">
            <Spinner size={32} tone="primary" />
            <p className="text-[15px] font-semibold text-[#0A1931]">Loading your invitations</p>
            <p className="text-[13px] text-[#5F6B80]">Checking the latest invitations from employers.</p>
          </div>
        ) : !pages.error && pages.items.length === 0 ? (
          <EmptyState icon={<Mail size={22} />} title={filter === "all" ? "No invitations yet" : `No ${statusLabels[filter].toLowerCase()} invitations`} message={filter === "all" ? "Your job invitations will appear here when an employer shortlists you for a role." : "Invitations with this status will appear here."} />
        ) : null}
        {!pages.isLoading ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{pages.items.map((invitation) => (
          <article key={invitation.id} className="group flex max-w-[460px] flex-col gap-3 rounded-[18px] border border-[#E9E4DA] bg-white p-4 shadow-[0_2px_10px_rgba(10,25,49,0.025)] transition-all duration-200 hover:-translate-y-0.5 hover:border-[#D9D1C3] hover:shadow-[0_12px_28px_rgba(10,25,49,0.07)]">
            <div className="flex items-start gap-3">
              <MonogramTile size={40}>{employerMonogram(invitation.employer_name)}</MonogramTile>
              <div className="min-w-0 flex-1 pt-0.5">
                <h2 className="text-[15px] font-bold leading-5 tracking-[-0.025em] text-[#0A1931]">{invitation.job_title ?? "Job no longer available"}</h2>
                <p className="mt-1 truncate text-[12px] leading-4 text-[#657187]">{invitation.employer_name ?? "Employer"}</p>
              </div>
              <StatusChip tone={statusTones[invitation.status]}>{statusLabels[invitation.status]}</StatusChip>
            </div>
            <div className="flex items-center gap-2 border-t border-[#F0ECE5] pt-2.5 text-[12px] text-[#738096]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#B9B2A6]" aria-hidden="true" />
              <p>Invited {formatDate(invitation.created_at)}</p>
              {invitation.answered_at ? <><span aria-hidden="true">·</span><p>{invitation.status === "ACCEPTED" ? "Accepted" : "Answered"} {formatDate(invitation.answered_at)}</p></> : null}
            </div>
            {invitation.status === "INVITED" ? (
              <div className="space-y-2.5 rounded-[15px] bg-[#FAF8F3] p-3">
                <p className="text-[12px] leading-[17px] text-[#657187]">{invitation.job_title === null ? "This job has left the board and can no longer be accepted." : "Accept to join the employer’s shortlist. Declining is final for this job."}</p>
                <div className="flex flex-wrap gap-2">
                  <PillButton disabled={actionState.isLoading || invitation.job_title === null} onClick={() => setPendingAction({ id: invitation.id, action: "accept" })} className="!px-3.5 !py-2 !text-[12px]">Accept invitation</PillButton>
                  <PillButton variant="secondary" disabled={actionState.isLoading} onClick={() => setPendingAction({ id: invitation.id, action: "decline" })} className="!px-3.5 !py-2 !text-[12px]">Decline</PillButton>
                </div>
              </div>
            ) : invitation.status === "CANCELLED" ? <p className="text-[13px] text-[#5F6B80]">The employer cancelled this invitation.</p> : null}
            <div className="mt-auto flex flex-wrap items-center gap-x-4 border-t border-[#F0ECE5] pt-1.5">
              {invitation.job_title !== null ? <Link href={`/student/jobs/${invitation.job_id}`} className={linkClass}>View job details <span aria-hidden="true" className="ml-1 transition-transform group-hover:translate-x-0.5">→</span></Link> : null}
              {invitation.application_id ? <Link href={`/student/board/${invitation.application_id}`} className={linkClass}>View application</Link> : null}
            </div>
          </article>
        ))}</div> : null}
        {!pages.isLoading && pages.hasMore ? <div className="flex justify-center"><PillButton variant="secondary" disabled={pages.isLoadingMore} onClick={pages.loadMore} className="px-5 py-2.5 text-[13px]">{pages.isLoadingMore ? "Loading..." : "Load more invites"}</PillButton></div> : null}
        <Modal
          open={pendingAction !== null}
          title={pendingAction?.action === "accept" ? "Accept this invitation?" : "Decline this invitation?"}
          description={pendingAction?.action === "accept"
            ? "This will add the application to your Shortlisted board."
            : "Declining is final. The employer cannot invite you to this job again."}
          onClose={() => setPendingAction(null)}
          closeDisabled={actionState.isLoading}
          panelClassName="max-w-[420px]"
        >
          <div className="flex justify-end gap-2">
            <PillButton variant="secondary" disabled={actionState.isLoading} onClick={() => setPendingAction(null)} className="!px-3.5 !py-2 !text-[12px]">Cancel</PillButton>
            <PillButton
              disabled={actionState.isLoading || (pendingAction?.action === "accept" && pages.items.find((item) => item.id === pendingAction.id)?.job_title === null)}
              onClick={() => { if (pendingAction) void respond(pendingAction.id, pendingAction.action); }}
              className={`!px-3.5 !py-2 !text-[12px] ${pendingAction?.action === "decline" ? "!bg-[#993A22] enabled:hover:!bg-[#7F2F1D]" : ""}`}
            >
              {actionState.isLoading ? (pendingAction?.action === "accept" ? "Accepting..." : "Declining...") : (pendingAction?.action === "accept" ? "Accept invitation" : "Confirm decline")}
            </PillButton>
          </div>
        </Modal>
      </div>
    </StudentPage>
  );
}
