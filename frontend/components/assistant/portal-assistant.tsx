"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type RefObject } from "react";
import Link from "next/link";
import {
  ArrowRight, BriefcaseBusiness, Check, ChevronRight, ExternalLink,
  ListChecks, MapPin, MessageCircle, RotateCcw, SendHorizontal,
  ShieldCheck, Sparkles, X,
} from "lucide-react";

import { useScrollLock } from "@/hooks/use-scroll-lock";
import { getApiErrorCode, getApiErrorMessage, getApiErrorParams } from "@/lib/api/error-message";
import { formatSalary, stageLabel, workModeLabel } from "@/features/student/formatters";
import type { JobApplication, JobListing, RecommendedJob } from "@/features/student/types";
import { useApplyToStudentJobMutation } from "@/store/student";
import { useSendAssistantMessageMutation, type AssistantReply, type AssistantTurn } from "@/store/student/assistant.api";

type Entry =
  | { id: number; kind: "user"; text: string }
  | { id: number; kind: "note"; text: string }
  | { id: number; kind: "assistant"; response: AssistantReply };

const STARTERS = [
  {
    title: "Find my best matches",
    description: "Jobs that fit your profile and skills",
    prompt: "Jobs that suit my profile",
    icon: Sparkles,
  },
  {
    title: "Explore remote jobs",
    description: "Discover flexible roles on the board",
    prompt: "Remote jobs",
    icon: MapPin,
  },
  {
    title: "Track my applications",
    description: "See where your applications stand",
    prompt: "Where are my applications?",
    icon: ListChecks,
  },
];

export function PortalAssistant() {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; message: string; code?: string } | null>(null);
  const [applied, setApplied] = useState<Record<string, "loading" | "done" | "error">>({});
  const [applyErrors, setApplyErrors] = useState<Record<string, string>>({});
  const [sendAssistantMessage] = useSendAssistantMessageMutation();
  const [applyToJob] = useApplyToStudentJobMutation();
  const stateRef = useRef<string | undefined>(undefined);
  const historyRef = useRef<AssistantTurn[]>([]);
  const nextId = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closingTimer = useRef<number | null>(null);

  useScrollLock(open || closing);

  useEffect(() => () => {
    if (closingTimer.current !== null) window.clearTimeout(closingTimer.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [open, entries, busy, error]);

  const close = () => {
    if (!open) return;
    setOpen(false);
    setClosing(true);
    if (closingTimer.current !== null) window.clearTimeout(closingTimer.current);
    const duration = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280;
    closingTimer.current = window.setTimeout(() => {
      setClosing(false);
      closingTimer.current = null;
      window.requestAnimationFrame(() => triggerRef.current?.focus());
    }, duration);
  };

  const reset = () => {
    setEntries([]);
    setError(null);
    setDraft("");
    setApplied({});
    setApplyErrors({});
    stateRef.current = undefined;
    historyRef.current = [];
    inputRef.current?.focus();
  };

  const send = async (raw: string, retry = false) => {
    const message = raw.trim();
    if (!message || message.length > 1000 || busy) return;
    if (!retry) setEntries((current) => [...current, { id: ++nextId.current, kind: "user", text: message }]);
    setDraft("");
    setError(null);
    setBusy(true);

    const request = { message, history: historyRef.current.slice(-12), ...(stateRef.current ? { state: stateRef.current } : {}) };
    try {
      let response: AssistantReply;
      try {
        response = await sendAssistantMessage(request).unwrap();
      } catch (firstError) {
        if (getApiErrorCode(firstError) !== "assistant_state_invalid") throw firstError;
        stateRef.current = undefined;
        historyRef.current = [];
        setEntries([{ id: ++nextId.current, kind: "note", text: "The chat expired. Starting a fresh conversation." }, { id: ++nextId.current, kind: "user", text: message }]);
        response = await sendAssistantMessage({ message, history: [] }).unwrap();
      }
      stateRef.current = response.state;
      historyRef.current = [...historyRef.current, { role: "user" as const, text: message }, { role: "assistant" as const, text: response.reply }].slice(-12);
      setEntries((current) => [...current, { id: ++nextId.current, kind: "assistant", response }]);
    } catch (caught) {
      const code = getApiErrorCode(caught);
      const retryAfter = getApiErrorParams(caught)?.retry_after_seconds;
      const messageText = code === "assistant_unavailable"
        ? "The assistant is unavailable right now. Try your message again."
        : code === "rate_limited" && typeof retryAfter === "number"
          ? `You've reached the chat limit. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`
          : getApiErrorMessage(caught, "Could not send your message. Try again.");
      setError({ text: message, message: messageText, code });
    } finally {
      setBusy(false);
    }
  };

  const confirmApply = async (jobId: string) => {
    if (applied[jobId] === "loading" || applied[jobId] === "done") return;
    setApplied((current) => ({ ...current, [jobId]: "loading" }));
    setApplyErrors((current) => ({ ...current, [jobId]: "" }));
    try {
      await applyToJob(jobId).unwrap();
      setApplied((current) => ({ ...current, [jobId]: "done" }));
      setEntries((current) => [...current, { id: ++nextId.current, kind: "note", text: "Applied ✓ — you can track it on your Application Board." }]);
    } catch (caught) {
      setApplied((current) => ({ ...current, [jobId]: "error" }));
      setApplyErrors((current) => ({ ...current, [jobId]: getApiErrorMessage(caught, "Could not apply to this job.") }));
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void send(draft);
  };

  const onDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") { event.stopPropagation(); close(); return; }
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), textarea:not([disabled]), a[href]');
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="bp-assistant">
      {!open && !closing && (
        <button
          ref={triggerRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open job assistant"
          className="bp-assistant-launcher fixed bottom-5 right-5 z-30 flex items-center gap-3 rounded-full border border-white/25 px-3 py-2.5 pr-4 text-left text-white shadow-[0_16px_40px_rgba(48,36,105,.3)] transition-transform hover:-translate-y-1 active:scale-95 sm:bottom-7 sm:right-7"
        >
          <span className="grid size-10 place-items-center rounded-full bg-white/20 ring-1 ring-white/20"><Sparkles size={20} strokeWidth={1.9} /></span>
          <span className="flex flex-col leading-tight">
            <span className="text-[13px] font-bold">Career assistant</span>
            <span className="mt-0.5 text-[10px] font-medium text-white/80">Ask BharatPath anything</span>
          </span>
          <span className="ml-1 size-2 rounded-full bg-[#B9F0C8] shadow-[0_0_0_4px_rgba(185,240,200,.18)]" aria-hidden="true" />
          <span className="absolute inset-0 -z-10 rounded-full bp-assistant-pulse" aria-hidden="true" />
        </button>
      )}

      {(open || closing) && (
        <div data-scroll-lock-root className="fixed inset-0 z-[110]" inert={closing}>
          <button type="button" tabIndex={-1} aria-label="Close assistant" onClick={close} data-state={closing ? "closing" : "open"} className="bp-assistant-scrim absolute inset-0 bg-[#0A1931]/35 backdrop-blur-[2px]" />
          <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="BharatPath job assistant" onKeyDown={onDialogKeyDown} data-state={closing ? "closing" : "open"} className="bp-assistant-panel absolute inset-x-0 bottom-0 flex h-[min(780px,96dvh)] flex-col overflow-hidden rounded-t-[28px] border bg-white shadow-[0_28px_90px_rgba(10,25,49,.24)] sm:inset-x-auto sm:bottom-5 sm:right-5 sm:h-[min(730px,calc(100dvh-40px))] sm:w-[min(455px,calc(100vw-40px))] sm:rounded-[28px]">
            <header className="bp-assistant-header relative flex shrink-0 items-center gap-3 border-b border-[#EEE8E0] bg-white px-5 py-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-[15px] bg-[#5F4DB2] text-white shadow-[0_7px_18px_rgba(95,77,178,.24)]"><Sparkles size={21} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#8675AE]">BharatPath</p>
                <h2 className="text-[17px] font-bold leading-5 tracking-[-.025em] text-[#0A1931]">Career assistant</h2>
                <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-[#5F6B80]"><span className="size-1.5 rounded-full bg-[#31A66A]" /> Here to help you move forward</p>
              </div>
              <button type="button" onClick={reset} disabled={busy} aria-label="Start a new conversation" title="New conversation" className="grid size-9 shrink-0 place-items-center rounded-xl text-[#667085] transition-colors hover:bg-[#F1EAF7] hover:text-[#5F4DB2] disabled:opacity-40"><RotateCcw size={17} /></button>
              <button type="button" onClick={close} aria-label="Close assistant" className="grid size-9 shrink-0 place-items-center rounded-xl text-[#667085] transition-colors hover:bg-[#F1EAF7] hover:text-[#5F4DB2]"><X size={19} /></button>
            </header>

            <div ref={listRef} className="bp-assistant-body bp-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5" aria-label="Conversation">
              {entries.length === 0 && (
                <div className="bp-assistant-welcome flex min-h-full flex-col">
                  <div className="bp-assistant-hero relative overflow-hidden rounded-[24px] px-5 py-5 text-white shadow-[0_18px_32px_rgba(58,43,129,.2)] sm:px-6 sm:py-6">
                    <span className="bp-assistant-hero-orbit pointer-events-none absolute -right-12 -top-16 size-44 rounded-full border border-white/20" aria-hidden="true" />
                    <span className="pointer-events-none absolute -right-4 -top-9 size-36 rounded-full border border-white/10" aria-hidden="true" />
                    <div className="relative flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.16em] text-[#E8DFFF]"><span className="grid size-7 place-items-center rounded-full bg-white/20"><Sparkles size={14} /></span> Your next step starts here</div>
                    <h3 className="relative mt-4 max-w-[300px] text-[23px] font-bold leading-[1.15] tracking-[-.035em] sm:text-[25px]">Let&apos;s find what&apos;s next for you.</h3>
                    <p className="relative mt-2 max-w-[310px] text-[12px] leading-[1.55] text-[#EEE9FF]">Discover roles that fit, explore new opportunities, and stay on top of your applications.</p>
                    <div className="relative mt-5 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-[10px] font-semibold text-white/90"><ShieldCheck size={12} /> Built around your career journey</div>
                  </div>

                  <div className="mt-6 flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[.15em] text-[#9B87BD]">Get started</p>
                      <h4 className="mt-1 text-[16px] font-bold tracking-[-.02em] text-[#0A1931]">What would you like to do?</h4>
                    </div>
                    <span className="shrink-0 text-[11px] text-[#8B8FA0]">Choose a prompt</span>
                  </div>
                  <div className="mt-3 grid gap-2.5">
                    {STARTERS.map((starter) => {
                      const Icon = starter.icon;
                      return (
                        <button key={starter.prompt} type="button" onClick={() => void send(starter.prompt)} disabled={busy} className="bp-assistant-starter group flex w-full items-center gap-3 rounded-[17px] border border-[#E8E1D7] bg-white p-3 text-left shadow-[0_3px_10px_rgba(10,25,49,.035)] transition-all hover:-translate-y-0.5 hover:border-[#C9B9EC] hover:shadow-[0_12px_24px_rgba(65,48,126,.1)] disabled:opacity-60">
                          <span className="grid size-10 shrink-0 place-items-center rounded-[13px] bg-[#F1EAF7] text-[#5F4DB2] transition-colors group-hover:bg-[#5F4DB2] group-hover:text-white"><Icon size={19} strokeWidth={1.8} /></span>
                          <span className="min-w-0 flex-1"><span className="block text-[13px] font-bold text-[#16243A]">{starter.title}</span><span className="mt-0.5 block text-[11px] leading-4 text-[#69758A]">{starter.description}</span></span>
                          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-[#F8F5FC] text-[#5F4DB2] transition-transform group-hover:translate-x-0.5"><ArrowRight size={14} /></span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-auto flex items-center justify-center gap-1.5 pt-5 text-center text-[11px] text-[#7C8596]"><MessageCircle size={13} /> Or ask in your own words, in your language</p>
                </div>
              )}
              {entries.map((entry) => {
                if (entry.kind === "user") return <div key={entry.id} className="flex justify-end"><div className="bp-assistant-user max-w-[86%] rounded-[19px] rounded-br-[6px] px-4 py-3 text-[13px] leading-[1.5] text-white shadow-[0_7px_18px_rgba(75,59,150,.15)]">{entry.text}</div></div>;
                if (entry.kind === "note") return <p key={entry.id} className="mx-auto max-w-[90%] rounded-full bg-[var(--assistant-soft)] px-3 py-2 text-center text-[11px] font-semibold text-[var(--assistant-accent)]">{entry.text}</p>;
                const response = entry.response;
                return <AssistantAnswer key={entry.id} response={response} scrollRoot={listRef} onSuggestion={(text) => void send(text)} onClose={close} onApply={() => response.apply && void confirmApply(response.apply.jobId)} applyStatus={response.apply ? applied[response.apply.jobId] : undefined} applyError={response.apply ? applyErrors[response.apply.jobId] : undefined} />;
              })}
              {busy && <div className="flex items-end gap-2" role="status" aria-label="Assistant is typing"><span className="grid size-7 place-items-center rounded-full bg-[var(--assistant-soft)] text-[var(--assistant-accent)]"><Sparkles size={13} /></span><span className="flex gap-1 rounded-[18px] rounded-bl-[5px] border border-[#E7E9EE] bg-white px-4 py-3"><i className="bp-assistant-dot" /><i className="bp-assistant-dot" /><i className="bp-assistant-dot" /></span></div>}
              {error && <div className="rounded-2xl border border-[#E9C7BF] bg-[#FFF5F2] p-3 text-[12px] text-[#8D3926]" role="alert"><p>{error.message}</p><div className="mt-2 flex gap-3"><button type="button" onClick={() => void send(error.text, true)} disabled={busy || error.code === "rate_limited"} className="font-bold underline underline-offset-2 disabled:opacity-50">Try again</button>{error.code === "subscription_required" && <Link href="/student/subscription" onClick={close} className="font-bold underline underline-offset-2">View plans</Link>}</div></div>}
            </div>

            <form onSubmit={submit} className="bp-assistant-composer shrink-0 border-t border-[#EEE8E0] bg-white px-4 pb-[max(15px,env(safe-area-inset-bottom))] pt-3.5 sm:px-5">
              <div className="flex items-end gap-2 rounded-[19px] border border-[#DCD4EB] bg-[#FFFEFF] p-2 shadow-[0_4px_18px_rgba(55,40,105,.06)] transition-all focus-within:border-[#8D78C8] focus-within:shadow-[0_4px_22px_rgba(95,77,178,.15)]">
                <textarea ref={inputRef} rows={1} maxLength={1000} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (!busy) void send(draft); } }} placeholder="Ask about jobs or applications…" aria-label="Message" className="max-h-28 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-[13px] leading-5 text-[#0A1931] outline-none placeholder:text-[#9295A5]" />
                <button type="submit" disabled={!draft.trim() || busy} aria-label="Send message" className="bp-assistant-send grid size-10 shrink-0 place-items-center rounded-[13px] text-white shadow-[0_5px_12px_rgba(95,77,178,.22)] transition-all hover:-translate-y-0.5 hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"><SendHorizontal size={18} /></button>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-[10px] text-[#8A93A3]">
                <span>Enter to send · Shift + Enter for a new line</span>
                <span className="flex shrink-0 items-center gap-1"><ShieldCheck size={11} /> You confirm applications</span>
              </div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}

function AssistantAnswer({ response, scrollRoot, onSuggestion, onClose, onApply, applyStatus, applyError }: {
  response: AssistantReply; scrollRoot: RefObject<HTMLDivElement | null>;
  onSuggestion: (text: string) => void; onClose: () => void; onApply: () => void;
  applyStatus?: "loading" | "done" | "error"; applyError?: string;
}) {
  const [shown, setShown] = useState(0);
  const characters = Array.from(response.reply);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const timer = window.setTimeout(() => setShown(characters.length), 0);
      return () => window.clearTimeout(timer);
    }
    const step = Math.max(1, Math.ceil(characters.length / 65));
    const timer = window.setInterval(() => setShown((current) => Math.min(characters.length, current + step)), 24);
    return () => window.clearInterval(timer);
  }, [characters.length]);
  useEffect(() => {
    const root = scrollRoot.current;
    if (root && root.scrollHeight - root.scrollTop - root.clientHeight < 160) {
      root.scrollTo({ top: root.scrollHeight });
    }
  }, [shown, scrollRoot]);
  const complete = shown >= characters.length;

  return <div className="bp-assistant-answer flex items-start gap-2.5">
    <span className="bp-assistant-answer-avatar mt-1 grid size-8 shrink-0 place-items-center rounded-[11px] text-white shadow-[0_5px_12px_rgba(95,77,178,.2)]"><Sparkles size={15} /></span>
    <div className="min-w-0 flex-1 space-y-2.5">
      <div>
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-[.12em] text-[#8272AD]">BharatPath</p>
        <div aria-live="polite" className="rounded-[19px] rounded-tl-[6px] border border-[#E9E2F0] bg-white px-4 py-3 text-[13px] leading-[1.6] text-[#26334B] shadow-[0_5px_16px_rgba(42,30,84,.045)]"><span className="sr-only">{response.reply}</span><span aria-hidden="true" className="whitespace-pre-wrap">{characters.slice(0, shown).join("")}{!complete && <span className="bp-assistant-caret">|</span>}</span></div>
      </div>
      {complete && <>
        {response.jobs.length > 0 && <div className="space-y-2">{response.jobs.map((job, index) => <AssistantJobCard key={job.id} job={job} index={index + 1} onClose={onClose} />)}</div>}
        {response.job && <AssistantJobCard job={response.job} onClose={onClose} />}
        {response.applications.length > 0 && <div className="space-y-2">{response.applications.map((application) => <ApplicationMiniCard key={application.id} application={application} onClose={onClose} />)}</div>}
        {response.apply && (response.apply.inApp ? <div className="rounded-2xl border border-[var(--assistant-border)] bg-[var(--assistant-soft)] p-3"><p className="text-[12px] font-semibold text-[#0A1931]">Apply to {response.apply.jobTitle}?</p><p className="mt-0.5 text-[11px] text-[#647087]">{response.apply.employerName ?? "Employer"}</p><button type="button" onClick={onApply} disabled={applyStatus === "loading" || applyStatus === "done"} className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-[var(--assistant-accent)] px-4 py-2 text-[12px] font-bold text-white transition-transform hover:-translate-y-0.5 disabled:opacity-60">{applyStatus === "done" ? <><Check size={14} /> Applied</> : applyStatus === "loading" ? "Applying…" : "Confirm application"}</button>{applyError && <p role="alert" className="mt-2 text-[11px] text-[#993A22]">{applyError}</p>}</div> : <Link href={`/student/jobs/${response.apply.jobId}`} onClick={onClose} className="bp-assistant-card-link inline-flex items-center gap-1.5 text-[12px] font-bold text-[var(--assistant-accent)]">Open job <ExternalLink size={13} /></Link>)}
        {response.hasMore && !response.suggestions.some((item) => /show more/i.test(item)) && <button type="button" onClick={() => onSuggestion("Show more")} className="bp-assistant-chip">Show more <ArrowRight size={13} /></button>}
        {response.suggestions.length > 0 && <div className="flex flex-wrap gap-1.5">{response.suggestions.map((suggestion) => <button key={suggestion} type="button" onClick={() => onSuggestion(suggestion)} className="bp-assistant-chip">{suggestion}<ChevronRight size={12} /></button>)}</div>}
      </>}
    </div>
  </div>;
}

function AssistantJobCard({ job, index, onClose }: { job: JobListing | RecommendedJob; index?: number; onClose: () => void }) {
  return <Link href={`/student/jobs/${job.id}`} onClick={onClose} className="bp-assistant-result block rounded-2xl border border-[var(--assistant-border)] bg-white p-3 transition-all hover:-translate-y-0.5 hover:shadow-md">
    <div className="flex items-start gap-2.5">{index && <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-[var(--assistant-soft)] text-xs font-bold text-[var(--assistant-accent)]">{index}</span>}<div className="min-w-0 flex-1"><p className="text-[13px] font-bold leading-4 text-[#0A1931]">{job.title}</p><p className="mt-1 text-[11px] text-[#647087]">{job.employerName ?? "Employer"} · {job.location ?? "Location not specified"}</p></div><ArrowRight size={15} className="shrink-0 text-[var(--assistant-accent)]" /></div>
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#526078]"><span>{formatSalary(job)}</span><span>·</span><span>{workModeLabel(job.workMode)}</span></div>
    {"matchedSkills" in job && job.matchedSkills.length > 0 && <p className="mt-1.5 text-[11px] text-[var(--assistant-accent)]">Matches: {job.matchedSkills.slice(0, 3).join(", ")}</p>}
    <p className="mt-2 text-[10px] font-semibold text-[var(--assistant-accent)]">{job.eligibility === "ELIGIBLE" ? "Eligible to apply" : job.eligibility === "SCORE_PENDING" ? "Score pending" : "Not eligible"}</p>
  </Link>;
}

function ApplicationMiniCard({ application, onClose }: { application: JobApplication; onClose: () => void }) {
  return <Link href={`/student/board/${application.id}`} onClick={onClose} className="bp-assistant-result flex items-center gap-2 rounded-2xl border border-[var(--assistant-border)] bg-white p-3 transition-all hover:-translate-y-0.5 hover:shadow-md"><span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[var(--assistant-soft)] text-[var(--assistant-accent)]"><BriefcaseBusiness size={16} /></span><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-bold text-[#0A1931]">{application.jobTitle ?? "Job application"}</span><span className="block truncate text-[11px] text-[#647087]">{application.employerName ?? "Employer"} · {stageLabel(application.stage)}</span></span><ArrowRight size={15} className="text-[var(--assistant-accent)]" /></Link>;
}
