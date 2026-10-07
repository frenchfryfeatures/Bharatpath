"use client";

import { useCallback } from "react";
import { useCursorLoadMore } from "@/lib/pagination/use-cursor-load-more";
import { useLazyGetEmployerInvitationsQuery } from "@/store/shortlist/shortlist.api";
import { EmployerErrorState } from "@/features/employer/components/employer-error-state";
import { useState } from "react";
import { BriefcaseBusiness, CalendarDays, CheckCircle2, Clock3, MapPin, Star, X } from "lucide-react";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import type { EmployerInvitation } from "@/store/shortlist/shortlist.api";
import { getScoreBand } from "../band";
import { useCancelEmployerInvitationMutation } from "@/store/shortlist/shortlist.api";
import { useConfirmDialog } from "@/features/employer/components/use-confirm-dialog";

export function InvitationColumn({ status, jobId }: { status: "INVITED" | "DECLINED"; jobId?: string }) {
  const [selected, setSelected] = useState<EmployerInvitation | null>(null);
  useScrollLock(selected !== null);
  const [load] = useLazyGetEmployerInvitationsQuery();
  const [cancelInvitation] = useCancelEmployerInvitationMutation();
  const { confirm, dialog } = useConfirmDialog();
  const pages = useCursorLoadMore(useCallback(async (cursor: string | undefined) => {
    const page = await load({ status, job_id: jobId, cursor, limit: 20 }).unwrap();
    return { items: page.items, nextCursor: page.next_cursor };
  }, [load, status, jobId]), [status, jobId]);
  return <>
  <section className="flex h-full min-h-0 w-64 shrink-0 flex-col overflow-hidden rounded-[11px] border border-[#e1e5eb] bg-[#f5f7f9]">
    <header className="flex items-center gap-2 px-3 py-3"><h2 className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#687384]">{status === "INVITED" ? "Invitation" : "Invitation rejected"}</h2><span className="grid h-[18px] min-w-[18px] place-items-center rounded-full bg-white px-1 text-[10px] font-semibold text-[#687384]">{pages.items.length}{pages.hasMore ? "+" : ""}</span></header>
    <div className="bp-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
      {pages.isLoading ? <p role="status" className="text-xs text-[#687182]">Loading invitations...</p> : null}
      {pages.error ? <EmployerErrorState error={pages.error} onRetry={pages.retry} /> : null}
      {!pages.isLoading && !pages.error && pages.items.length === 0 ? <div className="flex flex-1 items-center justify-center px-4 text-center"><p className="text-[11px] leading-4 text-[#9aa2af]">{status === "INVITED" ? "No pending invitations" : "No rejected invitations"}</p></div> : null}
      {pages.items.map((invitation) => <InvitationCard key={invitation.id} invitation={invitation} status={status} onClick={() => setSelected(invitation)} />)}
      {pages.hasMore ? <button type="button" onClick={pages.loadMore} disabled={pages.isLoadingMore} className="w-full rounded-lg border border-[#d9dee7] bg-white p-2 text-xs text-[#51449a]">{pages.isLoadingMore ? "Loading..." : "Load more"}</button> : null}
    </div>
  </section>
  {selected && <InvitationDrawer invitation={selected} status={status} onClose={() => setSelected(null)} onCancel={status === "INVITED" ? () => confirm({
    title: "Cancel this invitation?",
    description: "The candidate will no longer be able to respond to this invitation. You can invite them again later.",
    confirmLabel: "Cancel invitation",
    tone: "danger",
    onConfirm: async () => {
      await cancelInvitation(selected.id).unwrap();
      setSelected(null);
      await pages.retry();
    },
  }) : undefined} />}
  {dialog}
  </>;
}

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "C"; }

function InvitationCard({ invitation, status, onClick }: { invitation: EmployerInvitation; status: "INVITED" | "DECLINED"; onClick: () => void }) {
  const name = invitation.candidate?.full_name ?? "Candidate unavailable";
  const band = invitation.candidate?.band?.toUpperCase() ?? "";
  const bandStyle = band === "STRONG"
    ? { label: "Strong", background: "#16845d", avatarBackground: "#eaf7f1", avatarColor: "#16845d" }
    : band === "SOLID"
      ? { label: "Solid", background: "#28578f", avatarBackground: "#edf3fb", avatarColor: "#28578f" }
      : band === "DEVELOPING"
        ? { label: "Developing", background: "#646e7c", avatarBackground: "#f0f2f5", avatarColor: "#687384" }
        : band === "ENTRY"
          ? { label: "Entry", background: "#8b6b25", avatarBackground: "#f5f1e8", avatarColor: "#8b6b25" }
          : null;
  const rejected = status === "DECLINED";
  return <button type="button" onClick={onClick} className="group relative flex w-full cursor-pointer flex-col gap-3 overflow-hidden rounded-xl border border-[#e1e5eb] bg-white p-3.5 text-left shadow-[0_1px_3px_rgba(19,26,38,0.045)] transition duration-200 hover:-translate-y-px hover:border-[#c8c2ec] hover:shadow-[0_8px_20px_rgba(49,58,94,0.09)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#51449a]/30">
    <span className="flex min-w-0 items-center gap-2.5"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-[10px] text-[11px] font-bold ring-1 ring-inset ring-black/[0.035]" style={{ background: bandStyle?.avatarBackground ?? "#f0f2f5", color: bandStyle?.avatarColor ?? "#687384" }}>{initials(name)}</span><span className="min-w-0 flex-1 truncate text-[12px] font-semibold leading-4 text-[#252d3b]">{name}</span><span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold leading-[14px] text-white" style={{ background: bandStyle?.background ?? "#687384" }}><Star size={11} fill="currentColor" strokeWidth={1.5} /><span>{bandStyle?.label ?? (status === "INVITED" ? "Invited" : "Rejected")}</span></span></span>
    <span className="block truncate text-[12px] font-medium leading-4 text-[#596579]">{invitation.job_title ?? "Job unavailable"}</span>
    <span className="flex items-center justify-between gap-2 border-t border-[#eef0f4] pt-2.5"><span className={`inline-flex items-center gap-1.5 text-[11px] font-medium leading-[14px] ${rejected ? "text-[#51449a]" : "text-[#687384]"}`}><span className={`h-1.5 w-1.5 rounded-full ${rejected ? "bg-[#8172ca]" : "bg-[#8b96a8]"}`} />{rejected ? "Rejected by candidate" : "Awaiting candidate response"}</span>{invitation.answered_at ? <span className="shrink-0 text-[10px] text-[#8a93a3]">{new Date(invitation.answered_at).toLocaleDateString("en-IN")}</span> : null}</span>
  </button>;
}

function InvitationDrawer({ invitation, status, onClose, onCancel }: { invitation: EmployerInvitation; status: "INVITED" | "DECLINED"; onClose: () => void; onCancel?: () => void }) {
  const name = invitation.candidate?.full_name ?? "Candidate unavailable";
  const profile = invitation.candidate;
  const band = profile ? getScoreBand(profile.band === "STRONG" ? 800 : profile.band === "SOLID" ? 700 : profile.band === "DEVELOPING" ? 500 : null) : getScoreBand(null);
  const location = [profile?.city, profile?.state_code].filter(Boolean).join(" · ") || "Location not shared";
  const isPending = status === "INVITED";
  return (
    <div data-scroll-lock-root className="fixed inset-0 z-50">
      <button type="button" aria-label="Close invitation drawer" onClick={onClose} className="absolute inset-0 cursor-default bg-[#172033]/35 backdrop-blur-[2px]" />
      <aside role="dialog" aria-modal="true" aria-labelledby="invitation-candidate-title" className="absolute inset-y-0 right-0 flex h-full w-[560px] max-w-full flex-col bg-white shadow-[-20px_0_60px_-24px_rgba(0,0,0,0.5)]">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#e8ebf0] bg-gradient-to-r from-white via-white to-[#f8f7ff] px-6 py-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#eeecff] text-[14px] font-bold text-[#51449a] ring-1 ring-inset ring-[#ded9ff]">{initials(name)}</div>
            <div className="min-w-0"><h2 id="invitation-candidate-title" className="truncate text-[19px] font-bold tracking-[-0.02em] text-[#172033]">{name}</h2><p className="mt-0.5 truncate text-[12px] text-[#7b8494]">Candidate {invitation.candidate_id.slice(0, 8)}</p></div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-[#687182] transition hover:bg-[#f1f3f6]"><X className="h-5 w-5" /></button>
        </header>
        <div className="bp-scrollbar min-h-0 flex-1 overflow-y-auto px-6 py-6">
          <div className="space-y-6">
            <div className="grid gap-3 sm:grid-cols-[1.2fr_0.8fr]">
              <section className="rounded-2xl border border-[#e5e8ee] bg-gradient-to-br from-[#fafbfc] to-[#f5f7fb] p-4">
                <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-[#7b8494]">Profile summary</p>
                <div className="mt-3 flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#edf2fa] px-2.5 py-1 text-[11px] font-semibold text-[#315c9f]">{profile?.band ? `${profile.band[0]}${profile.band.slice(1).toLowerCase()} band` : "Band unavailable"}</span><span className="text-[12px] text-[#687182]">{profile?.experience_years ?? "—"} {profile?.experience_years === 1 ? "year" : "years"} of experience</span></div>
                <div className="mt-4 flex items-center gap-2 text-[13px] font-medium text-[#43516a]"><MapPin className="h-4 w-4 shrink-0 text-[#6f7c91]" aria-hidden="true" /><span>{location}</span></div>
              </section>
              <section className={`rounded-2xl border p-4 ${isPending ? "border-[#dce5f3] bg-gradient-to-br from-[#f3f7fc] to-[#edf3fb]" : "border-[#e7e2f7] bg-gradient-to-br from-[#f8f6ff] to-[#f1effb]"}`}>
                <p className="text-[11px] font-bold uppercase tracking-[0.09em] text-[#62718a]">Invitation status</p>
                <div className="mt-3 flex items-start gap-2"><span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-white ${isPending ? "text-[#315f9b]" : "text-[#6d5abd]"}`}>{isPending ? <Clock3 className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}</span><div><p className={`text-[17px] font-bold leading-5 ${isPending ? "text-[#28578f]" : "text-[#51449a]"}`}>{isPending ? "Awaiting response" : "Rejected"}</p><p className="mt-2 flex items-center gap-1.5 text-[11px] text-[#718096]"><CalendarDays className="h-3.5 w-3.5" />Sent {new Date(invitation.created_at).toLocaleDateString("en-IN")}</p></div></div>
              </section>
            </div>
            <section><h3 className="text-[13px] font-bold uppercase tracking-[0.07em] text-[#596579]">Skills</h3>{profile?.skills && profile.skills.length > 0 ? <div className="mt-3 flex flex-wrap gap-2">{profile.skills.map((skill: string) => <span key={skill} className="rounded-full border border-[#e3e7ed] bg-[#f7f8fa] px-3 py-1.5 text-[12px] font-medium text-[#344054]">{skill}</span>)}</div> : <p className="mt-3 text-xs text-[#7b8494]">No skills were provided.</p>}</section>
            <section className="relative overflow-hidden rounded-2xl border border-[#e1e6ef] bg-white p-4 shadow-[0_3px_12px_rgba(23,32,51,0.04)]">
              <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-[#7669d5] to-[#b3aaf0]" />
              <div className="flex items-start gap-3 pl-1"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#f0efff] text-[#5a4eb4]"><BriefcaseBusiness className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#7b8494]">Job invitation</p><h3 className="mt-1 truncate text-[14px] font-semibold text-[#273142]">{invitation.job_title ?? "Job unavailable"}</h3><p className="mt-1.5 text-[12px] text-[#51449a]">{isPending ? "Awaiting candidate response" : "Rejected by candidate"}</p>{invitation.answered_at ? <p className="mt-1.5 text-[11px] text-[#777f90]">Answered {new Date(invitation.answered_at).toLocaleDateString("en-IN")}</p> : null}</div></div>
            </section>
          </div>
        </div>
        <footer className="flex shrink-0 justify-between border-t border-[#e8ebf0] bg-[#fafbfc] px-6 py-3">{onCancel ? <button type="button" onClick={onCancel} className="rounded-lg border border-[#f0c5ca] bg-white px-4 py-2 text-[12px] font-semibold text-[#b42332] hover:bg-[#fff3f4]">Cancel invitation</button> : <span /> }<button type="button" onClick={onClose} className="rounded-lg border border-[#d9dee7] bg-white px-4 py-2 text-[12px] font-semibold text-[#344054] hover:bg-[#f5f6f8]">Close</button></footer>
      </aside>
    </div>
  );
}
