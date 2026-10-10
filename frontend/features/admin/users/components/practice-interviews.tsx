"use client";

import { humanizeCode } from "@/lib/format/labels";

import { useState } from "react";
import { ChevronDown, Headphones, Mic2, RotateCw } from "lucide-react";

import { Skeleton } from "@/components/common/loading";
import {
  useGetAdminCandidateRecordingsQuery,
  type InterviewRow,
} from "@/store/api/admin-api";

const dateTime = (value: string | null) => value
  ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
  : "-";

const label = humanizeCode;

function formatDuration(ms: number | null) {
  if (ms === null) return null;
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function Recordings({ candidateId, session }: { candidateId: string; session: InterviewRow }) {
  const recordings = useGetAdminCandidateRecordingsQuery({ id: candidateId, sessionId: session.id }, { refetchOnMountOrArgChange: true });

  return <div className="border-t border-[#e7e9ee] bg-[#fbfcfe] px-4 py-4">
    <div className="mb-3 flex items-center justify-between gap-3">
      <h4 className="text-[12px] font-bold text-[#172033]">Answers and recordings</h4>
      {recordings.data && <button type="button" onClick={() => void recordings.refetch()} className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#315c9f] hover:underline"><RotateCw size={12} /> Refresh audio links</button>}
    </div>
    {recordings.isLoading ? <div className="space-y-3"><Skeleton height={82} width="100%" /><Skeleton height={82} width="100%" /></div>
      : recordings.error ? <p className="rounded-lg border border-[#e7e9ee] bg-white p-3 text-[12px] text-[#687182]">Recordings could not be opened. Your staff role may not have recording access.</p>
      : recordings.data?.length ? <ol className="space-y-3">{recordings.data.map((answer) => <li key={answer.question_index} className="rounded-lg border border-[#e7e9ee] bg-white p-3">
          <div className="flex items-start gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#eef3fb] text-[10px] font-bold text-[#315c9f]">{answer.question_index + 1}</span><div className="min-w-0 flex-1"><p className="text-[12px] font-semibold leading-5 text-[#172033]">{answer.prompt}</p><div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-[#7b8494]">{answer.duration_ms !== null && <span>Duration {formatDuration(answer.duration_ms)}</span>}{answer.uploaded_at && <span>Recorded {dateTime(answer.uploaded_at)}</span>}</div></div></div>
          <div className="mt-3 flex items-center gap-2"><Headphones size={15} className="shrink-0 text-[#315c9f]" /><audio key={answer.url} controls preload="none" src={answer.url} className="h-9 min-w-0 flex-1" aria-label={`Answer ${answer.question_index + 1} recording`} /></div>
          {answer.transcript && <div className="mt-3 rounded-md bg-[#f8f9fb] px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wide text-[#8992a1]">Transcript</p><p className="mt-1 whitespace-pre-wrap text-[11px] leading-5 text-[#526074]">{answer.transcript}</p></div>}
        </li>)}</ol>
      : <p className="rounded-lg border border-dashed border-[#dfe4ec] bg-white p-4 text-[12px] text-[#7b8494]">No audio answers have been stored for this interview.</p>}
  </div>;
}

export function PracticeInterviews({ candidateId, sessions }: { candidateId: string; sessions: InterviewRow[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const completed = sessions.filter((session) => session.state === "COMPLETED" || session.state === "EVALUATED").length;

  if (!sessions.length) return <div className="flex flex-col items-center rounded-lg border border-dashed border-[#dfe4ec] bg-[#fbfcfe] px-5 py-7 text-center"><span className="grid h-10 w-10 place-items-center rounded-full bg-[#eef3fb] text-[#315c9f]"><Mic2 size={19} /></span><p className="mt-3 text-[12px] font-semibold text-[#172033]">No practice interviews yet</p><p className="mt-1 max-w-xs text-[11px] leading-5 text-[#7b8494]">Sessions, questions, and audio answers will appear here after the student starts an interview.</p></div>;

  return <div>
    <div className="mb-4 flex flex-wrap gap-2"><span className="rounded-full bg-[#eef3fb] px-2.5 py-1 text-[11px] font-semibold text-[#315c9f]">{sessions.length} sessions</span><span className="rounded-full bg-[#eaf5ef] px-2.5 py-1 text-[11px] font-semibold text-[#23805d]">{completed} completed</span></div>
    <div className="overflow-hidden rounded-lg border border-[#e7e9ee]">{sessions.map((session, index) => <div key={session.id} className={index ? "border-t border-[#e7e9ee]" : ""}>
      <button type="button" aria-expanded={selectedId === session.id} onClick={() => setSelectedId(selectedId === session.id ? null : session.id)} className="flex w-full items-start gap-3 bg-white px-4 py-4 text-left hover:bg-[#fafbfd]">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#eef3fb] text-[#315c9f]"><Mic2 size={17} /></span>
        <span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="text-[13px] font-bold text-[#172033]">Interview {session.session_number}</span><span className="rounded-full bg-[#f1f3f6] px-2 py-0.5 text-[10px] font-semibold text-[#526074]">{label(session.state)}</span></span><span className="mt-1 block text-[11px] text-[#687182]">{session.question_set_title} · {dateTime(session.created_at)}</span><span className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-[#7b8494]"><span>{session.answers_stored} of {session.questions_asked} answers stored</span><span>Feedback: {label(session.report_status)}</span></span></span>
        <ChevronDown size={16} className={`mt-2 shrink-0 text-[#7b8494] transition-transform ${selectedId === session.id ? "rotate-180" : ""}`} />
      </button>
      {selectedId === session.id && <Recordings candidateId={candidateId} session={session} />}
    </div>)}</div>
  </div>;
}
