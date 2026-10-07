"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useGetInterviewSessionQuery, useGetInterviewUploadMutation, useCompleteInterviewAnswerMutation, useNextInterviewQuestionMutation, useCompleteInterviewMutation } from "@/store/student/learning.api";
import { StudentPage } from "@/features/student/shell";
import { Skeleton } from "@/components/common/loading";
import { Clock, LoaderCircle, Mic, Square } from "lucide-react";
import { MeterBar, PillButton, SectionEyebrow, StatusChip, StudentAudioPlayer, StudentCard, StudentErrorState } from "@/features/student/components";

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
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveStage, setSaveStage] = useState<"saving" | "preparing">("saving");
  const [error, setError] = useState("");
  const current = session.data?.questions.find((q) => session.data?.answers.find((a) => a.question_index === q.index)?.upload_state !== "STORED");
  const clipUrl = useMemo(() => clip ? URL.createObjectURL(clip) : null, [clip]);
  useEffect(() => () => { if (clipUrl) URL.revokeObjectURL(clipUrl); }, [clipUrl]);
  useEffect(() => () => { if (stopTimer.current) clearTimeout(stopTimer.current); if (recorder.current?.state === "recording") recorder.current.stop(); stream.current?.getTracks().forEach((track) => track.stop()); }, []);
  async function record() {
    setError(""); setClip(null);
    try { const media = await navigator.mediaDevices.getUserMedia({ audio: true }); stream.current = media;
      const mime = ["audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const chunks: BlobPart[] = []; const next = new MediaRecorder(media, mime ? { mimeType: mime } : undefined);
      next.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      next.onstop = () => { if (stopTimer.current) clearTimeout(stopTimer.current); setClip(new Blob(chunks, { type: next.mimeType.split(";")[0] })); setDuration(Date.now() - started.current); media.getTracks().forEach((track) => track.stop()); setRecording(false); };
      recorder.current = next; started.current = Date.now(); next.start(); setRecording(true);
      stopTimer.current = setTimeout(() => { if (next.state === "recording") next.stop(); }, (current?.answer_seconds ?? 120) * 1000);
    } catch { setError("Microphone permission is required to record your answer."); }
  }
  function stop() { recorder.current?.stop(); }
  async function send() {
    if (!clip || !current || busy) return; setBusy(true); setSaveStage("saving"); setError("");
    try {
      const signed = await upload({ id, index: current.index }).unwrap();
      if (clip.size > signed.max_bytes || duration > signed.max_duration_ms || !signed.accepted_types.includes(clip.type)) throw new Error("Recording format, size or length is not accepted. Please record again.");
      const response = await fetch(signed.url, { method: "PUT", headers: { "Content-Type": clip.type }, body: clip });
      if (!response.ok) throw new Error("Recording upload failed. Please retry.");
      await completeAnswer({ id, index: current.index, durationMs: duration }).unwrap();
      setClip(null);
      if (current.index + 1 < (session.data?.questions_total ?? 0)) {
        setSaveStage("preparing");
        await nextQuestion(id).unwrap();
      }
      await session.refetch();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save the answer. Please retry."); }
    finally { setBusy(false); }
  }
  async function finish() { setError(""); try { await complete(id).unwrap(); await session.refetch(); } catch { setError("Could not finish the interview. Please retry."); } }
  const saved = session.data?.questions.filter((q) => session.data?.answers.find((a) => a.question_index === q.index)?.upload_state === "STORED").length ?? 0;
  const total = session.data?.questions_total ?? 0;
  const done = session.data?.state === "COMPLETED" || session.data?.state === "EVALUATED";
  const allStored = session.data?.answers.every((a) => a.upload_state === "STORED");
  return <StudentPage className={busy ? "flex min-h-full items-center justify-center" : ""}>
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
    {busy ? (
      <div
        className="flex flex-col items-center justify-center px-6 py-8 text-center"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <span className="grid h-14 w-14 place-items-center rounded-full bg-[#F1EAF7] text-[#5F4DB2]">
          <LoaderCircle className="h-7 w-7 animate-spin" aria-hidden="true" />
        </span>
        <p className="mt-4 text-[16px] font-bold text-[#0A1931]">
          {saveStage === "saving" ? "Saving your answer…" : "Preparing your next question…"}
        </p>
        <p className="mt-2 text-[13px] leading-5 text-[#5F6B80]">
          Please keep this page open. This may take a few moments.
        </p>
      </div>
    ) : session.isLoading ? (
      <div role="status" aria-label="Loading your interview" className="flex flex-col gap-4">
        <StudentCard className="!p-5"><Skeleton width="35%" height={14} radius={6} /><Skeleton className="mt-4" width="100%" height={6} radius={999} /></StudentCard>
        <StudentCard className="!p-5"><Skeleton width="75%" height={24} radius={8} /><Skeleton className="mt-3" width="52%" height={13} radius={6} /><Skeleton className="mt-7" width="100%" height={88} radius={15} /></StudentCard>
      </div>
    ) : session.error ? (
      <StudentErrorState title="Interview unavailable" error={session.error} fallback="We could not load this interview." onRetry={() => void session.refetch()} />
    ) : session.data ? <>
      <StudentCard className="!p-5">
        <div className="flex items-center justify-between gap-3">
          <SectionEyebrow>{current ? `Question ${current.index + 1} of ${total}` : "Mock interview"}</SectionEyebrow>
          <span className="shrink-0 text-[12px] font-semibold text-[#5F6B80]">{saved} of {total} answers saved</span>
        </div>
        <div className="mt-3"><MeterBar value={total ? (saved / total) * 100 : 0} height={6} /></div>
      </StudentCard>

      {current ? <StudentCard className="!p-5 sm:!p-6">
        <h2 className="text-[20px] font-bold leading-[28px] text-[#0A1931] sm:text-[22px] sm:leading-[30px]">{current.prompt}</h2>
        <div className="mt-4 flex flex-wrap gap-2">
          <StatusChip tone="neutral" icon={<Clock size={12} />}>{current.preparation_seconds}s to prepare</StatusChip>
          <StatusChip tone="waiting" icon={<Mic size={12} />}>Up to {current.answer_seconds}s to answer</StatusChip>
        </div>

        <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl bg-[#F7F4EC] px-4 py-6 text-center">
          {recording ? <>
            <span className="relative grid h-14 w-14 place-items-center"><span className="absolute inset-0 animate-ping rounded-full bg-red-500/25" /><span className="relative grid h-14 w-14 place-items-center rounded-full bg-red-600 text-white"><Mic size={22} /></span></span>
            <p className="text-[13px] font-semibold text-[#0A1931]">Recording in progress. Speak clearly.</p>
            <PillButton variant="secondary" onClick={stop} icon={<Square size={14} fill="currentColor" />} className="!px-6 !py-3 !text-[14px]">Stop recording</PillButton>
          </> : <>
            <span className="grid h-14 w-14 place-items-center rounded-full bg-white text-[#5F4DB2] shadow-sm"><Mic size={22} /></span>
            <p className="text-[13px] text-[#5F6B80]">{clip ? "Happy with it? Save, or record again." : "Press record when you are ready."}</p>
            <PillButton onClick={record} disabled={busy} icon={<Mic size={16} />} className="!px-6 !py-3 !text-[14px]">{clip ? "Record again" : "Record answer"}</PillButton>
          </>}
        </div>

        {clip && clipUrl && !recording ? <div className="mt-4 space-y-4">
          <StudentAudioPlayer src={clipUrl} knownDurationMs={duration} label="your answer" />
          <PillButton onClick={send} disabled={busy} className="w-full !py-3.5 !text-[14px]">{busy ? "Saving…" : "Save answer and continue"}</PillButton>
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
