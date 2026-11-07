"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGetInterviewSessionQuery, useGetInterviewQuestionAudioQuery, useGetInterviewUploadMutation, useCompleteInterviewAnswerMutation, useNextInterviewQuestionMutation, useCompleteInterviewMutation } from "@/store/student/learning.api";
import { StudentPage } from "@/features/student/shell";
import { Skeleton } from "@/components/common/loading";
import { Brain, Clock, LoaderCircle, Mic, Sparkles, Square } from "lucide-react";
import { MeterBar, PillButton, SectionEyebrow, StatusChip, StudentAudioPlayer, StudentCard, StudentErrorState } from "@/features/student/components";

const clock = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

/** Reads the question aloud as soon as it is on screen. Best effort: the written question is always the source of truth. */
function QuestionAudio({ sessionId, index }: { sessionId: string; index: number }) {
  const audio = useGetInterviewQuestionAudioQuery({ id: sessionId, index });
  const url = audio.data?.url;
  if (audio.isLoading) return <p className="mt-3 flex items-center gap-2 text-[12px] text-[#5F6B80]"><LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />Loading audio…</p>;
  if (!url) return null;
  return <StudentAudioPlayer src={url} autoPlay label="the question" heading="Interviewer audio" className="mt-4" />;
}

/** Shown from the moment an answer is sent until the next question is on screen. */
function NextQuestionWait() {
  // The core icon alternates between a question mark and the thinking brain until the question arrives.
  const [thinking, setThinking] = useState(false);
  useEffect(() => {
    const swap = setInterval(() => setThinking((value) => !value), 2200);
    return () => clearInterval(swap);
  }, []);
  return <div role="status" aria-live="polite" aria-busy="true" className="flex min-h-[420px] flex-col items-center justify-center px-6 py-10 text-center">
    <style>{`
      @keyframes bp-wait-ripple { 0% { transform: scale(0.62); opacity: 0.9; } 100% { transform: scale(1.12); opacity: 0; } }
      @keyframes bp-wait-breathe { 0%, 100% { transform: scale(0.94); opacity: 0.75; } 50% { transform: scale(1.06); opacity: 1; } }
      @keyframes bp-wait-float { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-6px) scale(1.05); } }
      @keyframes bp-wait-twinkle { 0%, 100% { transform: scale(1) rotate(0deg); } 50% { transform: scale(1.25) rotate(25deg); } }
      @keyframes bp-wait-swap { 0% { transform: scale(0.4) rotate(-12deg); opacity: 0; } 100% { transform: scale(1) rotate(0); opacity: 1; } }
      @keyframes bp-wait-dots { 0%, 20% { opacity: 0.2; } 50% { opacity: 1; } 100% { opacity: 0.2; } }
      @media (prefers-reduced-motion: reduce) { .bp-wait * { animation: none !important; } }
    `}</style>
    <span className="bp-wait relative grid h-[230px] w-[230px] place-items-center">
      <span className="absolute inset-0 rounded-full border-[3px] border-[#DCD3F3]" style={{ animation: "bp-wait-ripple 2.2s ease-out infinite" }} />
      <span className="absolute inset-0 rounded-full border-[3px] border-[#DCD3F3]" style={{ animation: "bp-wait-ripple 2.2s ease-out 1.1s infinite" }} />
      <span className="absolute inset-[34px] rounded-full bg-[#F1EDFA]" style={{ animation: "bp-wait-breathe 2.2s ease-in-out infinite" }} />
      <span className="relative grid h-[116px] w-[116px] place-items-center rounded-full bg-[#5F4DB2] text-white shadow-[0_12px_30px_rgba(95,77,178,0.35)]" style={{ animation: "bp-wait-float 2.2s ease-in-out infinite" }}>
        {thinking ? <>
          <span key="brain" className="grid place-items-center" style={{ animation: "bp-wait-swap 0.5s ease-out" }}><Brain size={52} fill="currentColor" strokeWidth={1.5} aria-hidden="true" /></span>
          <span key="spark" className="absolute -right-1 -top-1 grid h-9 w-9 place-items-center rounded-full bg-[#3B2E7E] text-[#FFC85A]" style={{ animation: "bp-wait-twinkle 1.6s ease-in-out infinite" }}><Sparkles size={18} fill="currentColor" aria-hidden="true" /></span>
        </> : <span key="question" className="grid place-items-center" style={{ animation: "bp-wait-swap 0.5s ease-out" }}><span className="text-[64px] font-bold leading-none" aria-hidden="true">?</span></span>}
      </span>
    </span>
    <p className="mt-6 max-w-[260px] text-[20px] font-bold leading-[26px] text-[#0A1931]">Please wait, next question is coming…</p>
  </div>;
}

export default function InterviewSessionPage() {
  const id = useParams<{ sessionId: string }>().sessionId;
  const session = useGetInterviewSessionQuery(id);
  const [upload] = useGetInterviewUploadMutation();
  const [completeAnswer] = useCompleteInterviewAnswerMutation();
  const [nextQuestion, nextState] = useNextInterviewQuestionMutation();
  const [complete, completeState] = useCompleteInterviewMutation();
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const stopTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(0);
  const [clip, setClip] = useState<Blob | null>(null);
  const [duration, setDuration] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = session.data?.questions.find((q) => session.data?.answers.find((a) => a.question_index === q.index)?.upload_state !== "STORED");
  const clipUrl = useMemo(() => clip ? URL.createObjectURL(clip) : null, [clip]);
  useEffect(() => () => { if (clipUrl) URL.revokeObjectURL(clipUrl); }, [clipUrl]);
  useEffect(() => {
    if (!recording) return;
    const tick = setInterval(() => setElapsed(Date.now() - started.current), 250);
    return () => clearInterval(tick);
  }, [recording]);
  useEffect(() => () => { if (stopTimer.current) clearTimeout(stopTimer.current); if (recorder.current?.state === "recording") recorder.current.stop(); stream.current?.getTracks().forEach((track) => track.stop()); }, []);
  async function record() {
    setError(""); setClip(null);
    try { const media = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = media;
      const mime = ["audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const chunks: BlobPart[] = []; const next = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      next.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      next.onstop = () => { if (stopTimer.current) clearTimeout(stopTimer.current); setClip(new Blob(chunks, { type: next.mimeType.split(";")[0] })); setDuration(Date.now() - started.current); media.getTracks().forEach((track) => track.stop()); setRecording(false); };
      recorder.current = next; started.current = Date.now(); setElapsed(0); next.start(); setRecording(true);
      stopTimer.current = setTimeout(() => { if (next.state === "recording") next.stop(); }, (current?.answer_seconds ?? 120) * 1000);
    } catch { setError("Microphone permission is required to record your answer."); }
  }
  function stop() { recorder.current?.stop(); }
  async function send() {
    if (!clip || !current || busy) return; setBusy(true); setError("");
    try {
      const signed = await upload({ id, index: current.index }).unwrap();
      if (clip.size > signed.max_bytes || duration > signed.max_duration_ms || !signed.accepted_types.includes(clip.type)) throw new Error("Recording format, size or length is not accepted. Please record again.");
      const response = await fetch(signed.url, { method: "PUT", headers: { "Content-Type": clip.type }, body: clip });
      if (!response.ok) throw new Error("Recording upload failed. Please retry.");
      await completeAnswer({ id, index: current.index, durationMs: duration }).unwrap();
      setClip(null);
      if (current.index + 1 < (session.data?.questions_total ?? 0)) await nextQuestion(id).unwrap();
      await session.refetch();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the answer. Please retry."); }
    finally { setBusy(false); }
  }
  async function finish() { setError(""); try { await complete(id).unwrap(); await session.refetch(); } catch { setError("Could not finish the interview. Please retry."); } }
  const total = session.data?.questions_total ?? 0;
  const storedCount = session.data?.questions.filter((q) => session.data?.answers.find((a) => a.question_index === q.index)?.upload_state === "STORED").length ?? 0;
  // While an answer is on its way, the header already reads as the next question.
  const advancing = busy && !!current && current.index + 1 < total;
  const saved = storedCount + (busy ? 1 : 0);
  const done = session.data?.state === "COMPLETED" || session.data?.state === "EVALUATED";
  const allStored = session.data?.answers.every((a) => a.upload_state === "STORED");
  return <StudentPage>
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
    {session.isLoading ? (
      <div role="status" aria-label="Loading your interview" className="flex flex-col gap-4">
        <StudentCard className="!p-5"><Skeleton width="35%" height={14} radius={6} /><Skeleton className="mt-4" width="100%" height={6} radius={999} /></StudentCard>
        <StudentCard className="!p-5"><Skeleton width="75%" height={24} radius={8} /><Skeleton className="mt-3" width="52%" height={13} radius={6} /><Skeleton className="mt-7" width="100%" height={88} radius={15} /></StudentCard>
      </div>
    ) : session.error ? (
      <StudentErrorState title="Interview unavailable" error={session.error} fallback="We could not load this interview." onRetry={() => void session.refetch()} />
    ) : session.data ? <>
      <StudentCard className="!p-5">
        <div className="flex items-center justify-between gap-3">
          <SectionEyebrow>{current ? `Question ${current.index + 1 + (advancing ? 1 : 0)} of ${total}` : "Mock interview"}</SectionEyebrow>
          <span className="shrink-0 text-[12px] font-semibold text-[#5F6B80]">{saved} of {total} answers saved</span>
        </div>
        <div className="mt-3"><MeterBar value={total ? (saved / total) * 100 : 0} height={6} /></div>
      </StudentCard>

      {busy ? <NextQuestionWait /> : current ? <StudentCard className="!p-5 sm:!p-6">
        <h2 className="text-[20px] font-bold leading-[28px] text-[#0A1931] sm:text-[22px] sm:leading-[30px]">{current.prompt}</h2>
        <QuestionAudio key={`${id}-${current.index}`} sessionId={id} index={current.index} />
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusChip tone="neutral" icon={<Clock size={12} />}>{current.preparation_seconds}s to prepare</StatusChip>
          <StatusChip tone="waiting" icon={<Mic size={12} />}>Up to {current.answer_seconds}s to answer</StatusChip>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl bg-[#F7F4EC] px-4 py-6 text-center">
          {recording ? <>
            <span className="relative grid h-16 w-16 place-items-center"><span className="absolute inset-0 rounded-full bg-red-500/25" /><span className="relative grid h-12 w-12 place-items-center rounded-full bg-red-600 text-white"><Mic size={22} /></span></span>
            <p className="text-[14px] font-semibold text-[#0A1931]">Recording in progress. Speak clearly.</p>
            <p className="font-mono text-[15px] font-bold tabular-nums text-red-600">{clock(elapsed)} / {clock(current.answer_seconds * 1000)}</p>
            <PillButton variant="secondary" onClick={stop} icon={<Square size={14} fill="currentColor" />} className="!px-6 !py-3 !text-[14px]">Stop recording</PillButton>
          </> : <>
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-[#5F4DB2] shadow-sm"><Mic size={22} /></span>
            <p className="text-[13px] text-[#5F6B80]">{clip ? "Happy with it? Save, or record again." : "Press record when you are ready."}</p>
            <PillButton onClick={record} disabled={busy} icon={<Mic size={16} />} className="!px-6 !py-3 !text-[14px]">{clip ? "Record again" : "Record answer"}</PillButton>
          </>}
        </div>

        {clip && clipUrl && !recording ? <div className="mt-4 space-y-4">
          <StudentAudioPlayer src={clipUrl} knownDurationMs={duration} label="your answer" />
          <PillButton onClick={send} disabled={busy} className="w-full !py-3.5 !text-[14px]">Keep and send answer</PillButton>
        </div> : null}
      </StudentCard> : done ? <StudentCard className="!p-6 text-center">
        <h2 className="text-[20px] font-bold text-[#0A1931]">Interview completed</h2>
        <p className="mt-1 text-[13px] text-[#5F6B80]">Nice work. Your report appears in your interview history.</p>
        <Link href="/student/interview" className="mt-4 inline-block text-[13px] font-semibold text-[#5F4DB2] hover:underline">View interview history</Link>
      </StudentCard> : allStored ? <StudentCard className="!p-6 text-center">
        <h2 className="text-[20px] font-bold text-[#0A1931]">All answers saved</h2>
        <p className="mt-1 text-[13px] text-[#5F6B80]">Finish to complete the session.</p>
        <PillButton onClick={finish} disabled={completeState.isLoading} className="mt-4 !px-8 !py-3 !text-[14px]">{completeState.isLoading ? "Finishing…" : "Finish interview"}</PillButton>
      </StudentCard> : <StudentCard className="!p-6 text-center">
        <p className="text-[14px] font-semibold text-[#0A1931]">{nextState.isLoading ? "Interviewer is thinking…" : "Your next question is ready to request."}</p>
        <PillButton variant="secondary" disabled={nextState.isLoading} onClick={async () => { try { await nextQuestion(id).unwrap(); await session.refetch(); } catch { setError("Could not prepare the next question. Please retry."); } }} className="mt-4 !px-6 !py-3 !text-[14px]">Get next question</PillButton>
      </StudentCard>}
    </> : null}
    {!busy && error && <StudentErrorState variant="inline" message={error} />}
  </div></StudentPage>;
}
