"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, CircleCheck, Clock3, LockKeyhole, Play, Sparkles, Video } from "lucide-react";

import { SimulatedPaymentDialog } from "@/components/billing/simulated-payment-dialog";
import { CourseDetailSkeleton } from "@/features/student/courses/course-skeletons";
import { EmptyState, MeterBar, NoteStrip, PillButton, StudentErrorState } from "@/features/student/components";
import { StudentPage } from "@/features/student/shell";
import { isStubPaymentUrl } from "@/store/api/payment.api";
import { type CourseLesson, type PaymentCheckout, useCheckoutCourseMutation, useGetCourseDetailQuery, useUpdateLessonProgressMutation } from "@/store/student/learning.api";

function durationLabel(seconds: number) {
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes} min`;
}

/** Titles sometimes carry their own "Module 1:" prefix; the page adds the number. */
const stripOrdinal = (title: string) => title.replace(/^(module|lesson)\s*\d+\s*[:.\-–]\s*/i, "");

export default function CoursePage() {
  const id = useParams<{ courseId: string }>().courseId;
  const course = useGetCourseDetailQuery(id);
  const [checkout, payment] = useCheckoutCourseMutation();
  const [saveProgress, progressState] = useUpdateLessonProgressMutation();
  const [activeLessonId, setActiveLessonId] = useState<string | null>(null);
  const [currentPosition, setCurrentPosition] = useState(0);
  const [error, setError] = useState("");
  const [simulatedCheckout, setSimulatedCheckout] = useState<PaymentCheckout | null>(null);
  const lessons = useMemo(() => course.data?.modules.flatMap((module) => module.lessons) ?? [], [course.data]);
  const activeLesson = lessons.find((lesson) => lesson.id === activeLessonId) ?? lessons.find((lesson) => !lesson.completed) ?? lessons[0];
  const activeIndex = activeLesson ? lessons.findIndex((lesson) => lesson.id === activeLesson.id) : -1;

  if (course.isLoading) return <CourseDetailSkeleton />;
  if (course.error || !course.data) return <StudentPage><StudentErrorState icon={<BookOpen size={22} />} title="Course unavailable" error={course.error} fallback="Could not load this course." /></StudentPage>;

  const data = course.data;
  const price = new Intl.NumberFormat("en-IN", { style: "currency", currency: data.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(data.price_minor / 100);

  async function buy() {
    setError("");
    try {
      const result = await checkout(id).unwrap();
      if (isStubPaymentUrl(result.redirect_url)) setSimulatedCheckout(result);
      else if (result.redirect_url) window.location.assign(result.redirect_url);
      else setError("Payment is pending. Refresh this page after it completes.");
    } catch { setError("Checkout is unavailable. Please try again."); }
  }

  function chooseLesson(lesson: CourseLesson) {
    setActiveLessonId(lesson.id);
    setCurrentPosition(lesson.position_seconds);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function reportProgress(lesson: CourseLesson, position: number, quiet = true) {
    try {
      const result = await saveProgress({ courseId: id, lessonId: lesson.id, positionSeconds: Math.floor(position) }).unwrap();
      if (!quiet) {
        if (!result.completed) {
          setError("Keep watching this lesson before completing it. At least 90% of the video must be watched.");
          return;
        }
        setError("");
        await course.refetch();
        const next = lessons[activeIndex + 1];
        if (next) chooseLesson(next);
      }
    } catch { if (!quiet) setError("Your progress could not be saved. Please try again."); }
  }

  return <StudentPage><div className="flex flex-col gap-5">
    <header className="flex items-center gap-3">
      <Link href="/student/courses" aria-label="Back to courses" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-[#E7E0D4] bg-white text-[#0A1931] transition hover:bg-[#FFFCF7]"><ArrowLeft size={20} /></Link>
      <div className="min-w-0"><h1 className="truncate text-[22px] font-bold tracking-[-0.03em] text-[#0A1931] sm:text-[28px]">{data.title}</h1><p className="mt-0.5 text-[13px] text-[#5F6B80]">{data.lessons_total} lessons · Readiness-building course</p></div>
    </header>

    {error ? <NoteStrip tone="amber">{error}</NoteStrip> : null}
    {data.locked ? <section className="rounded-[22px] border border-[#E7E0D4] bg-white p-5 sm:p-7"><div className="flex items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-[#F1EAF7] text-[#5F4DB2]"><LockKeyhole size={22} /></span><div><h2 className="text-[20px] font-bold text-[#0A1931]">Unlock this course</h2><p className="mt-1 text-[14px] leading-6 text-[#5F6B80]">Purchase once to watch every lesson and save your progress.</p></div></div><div className="mt-5"><PillButton onClick={() => void buy()} disabled={payment.isLoading}>{payment.isLoading ? "Preparing payment…" : `Unlock for ${price}`}</PillButton></div></section>
      : activeLesson ? <section className="overflow-hidden rounded-[22px] border border-[#DCD5C9] bg-[#0A1931] shadow-[0_14px_35px_rgba(10,25,49,0.12)]">
        <LessonPlayer key={activeLesson.id} lesson={activeLesson} onPosition={setCurrentPosition} onProgress={(position) => void reportProgress(activeLesson, position)} />
        <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div className="min-w-0"><p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#44D6A2]"><span className="h-2 w-2 rounded-full bg-[#44D6A2]" /> Now playing</p><p className="mt-1 truncate text-[16px] font-semibold text-white">Lesson {activeIndex + 1}: {stripOrdinal(activeLesson.title)}</p></div><div className="flex shrink-0 gap-2">
          <button type="button" disabled={progressState.isLoading || activeLesson.completed} onClick={() => void reportProgress(activeLesson, Math.max(currentPosition, activeLesson.position_seconds), false)} className="inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-4 text-[12px] font-bold text-[#5F4DB2] disabled:cursor-not-allowed disabled:opacity-70 sm:flex-none"><Check size={15} /> {activeLesson.completed ? "Completed" : progressState.isLoading ? "Saving…" : "Complete"}</button>
          <button type="button" disabled={!lessons[activeIndex + 1]} onClick={() => lessons[activeIndex + 1] && chooseLesson(lessons[activeIndex + 1])} className="inline-flex h-10 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#6B4FC7] px-5 text-[12px] font-bold text-white disabled:cursor-default disabled:opacity-40 sm:flex-none">Next <ArrowRight size={15} /></button>
        </div></div>
      </section> : null}

    <section className="rounded-[22px] border border-[#E7E0D4] bg-white p-5 sm:p-6">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#FFF3C7] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#9A4C17]"><Sparkles size={14} /> Readiness advantage</span>
      <h2 className="mt-4 text-[23px] font-bold tracking-[-0.03em] text-[#0A1931]">{data.title}</h2>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[#5F6B80]"><span className="inline-flex items-center gap-2"><BookOpen size={16} /> {data.lessons_total} Lessons</span><span className="inline-flex items-center gap-2"><Clock3 size={16} /> Self-paced learning</span></div>
      {!data.locked ? <div className="mt-5"><div className="mb-2 flex justify-between gap-4 text-[12px]"><span className="font-bold text-[#0A1931]">{data.percent_complete}% completed</span><span className="text-[#5F6B80]">{data.lessons_completed} of {data.lessons_total} watched</span></div><MeterBar value={data.percent_complete} height={7} /></div> : null}
    </section>

    <section><h2 className="mb-3 text-[13px] font-bold uppercase tracking-[0.16em] text-[#5F6B80]">Course syllabus</h2><div className="space-y-4">
      {data.modules.length ? data.modules.map((module, moduleIndex) => <article key={module.id} className="rounded-[22px] border border-[#E7E0D4] bg-white p-4 sm:p-5"><h3 className="mb-4 text-[17px] font-bold text-[#0A1931]">Module {moduleIndex + 1}: {stripOrdinal(module.title)}</h3><div className="space-y-3">{module.lessons.map((lesson) => {
        const index = lessons.findIndex((item) => item.id === lesson.id);
        const playing = activeLesson?.id === lesson.id && !data.locked;
        return <button key={lesson.id} type="button" disabled={data.locked} onClick={() => chooseLesson(lesson)} className={`flex w-full items-start gap-3 rounded-[16px] border p-4 text-left transition disabled:cursor-not-allowed ${playing ? "border-[#6B4FC7] bg-[#F7F3FF]" : "border-[#ECE7DE] bg-[#FFFEFC] hover:border-[#CFC3EB]"}`}><span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${lesson.completed ? "bg-[#23835B] text-white" : playing ? "bg-[#6B4FC7] text-white" : "border border-[#6B4FC7] text-[#6B4FC7]"}`}>{lesson.completed ? <Check size={15} /> : data.locked ? <LockKeyhole size={13} /> : <Play size={13} fill="currentColor" />}</span><span className="min-w-0 flex-1"><span className={`block text-[14px] font-bold leading-5 ${playing ? "text-[#5F4DB2]" : "text-[#0A1931]"}`}>Lesson {index + 1}: {stripOrdinal(lesson.title)}</span>{lesson.description ? <span className="mt-1 block text-[12px] leading-5 text-[#5F6B80]">{lesson.description}</span> : null}<span className="mt-2 block text-[11px] text-[#8290A4]">{durationLabel(lesson.duration_seconds)}{lesson.completed ? " · Finished" : ""}</span></span>{playing ? <span className="mt-1 rounded-full bg-[#6B4FC7] px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide text-white">Playing</span> : null}</button>;
      })}</div></article>) : <EmptyState icon={<Video size={22} />} title="Lessons coming soon" message="Lessons will appear here when this course is published." />}
    </div></section>

    {data.completed ? <div className="flex items-center gap-3 rounded-[18px] border border-[#CDE6D7] bg-[#F0F8F3] p-4 text-[#1F6B45]"><CircleCheck size={22} /><div><p className="text-[14px] font-bold">Course completed</p><p className="text-[12px]">Your learning achievement has been recorded.</p></div></div> : null}
    {simulatedCheckout ? <SimulatedPaymentDialog paymentId={simulatedCheckout.payment_id} amountMinor={simulatedCheckout.amount_minor} currency={simulatedCheckout.currency} title={data.title} onComplete={() => course.refetch()} onClose={() => setSimulatedCheckout(null)} /> : null}
  </div></StudentPage>;
}

function LessonPlayer({ lesson, onPosition, onProgress }: { lesson: CourseLesson; onPosition: (position: number) => void; onProgress: (position: number) => void }) {
  const lastReported = useRef(lesson.position_seconds);
  if (!lesson.media_url) return <div className="grid aspect-video place-items-center bg-[#101D34] px-5 text-center text-[13px] text-white/70">This lesson&apos;s video is temporarily unavailable.</div>;
  if (lesson.media_kind === "YOUTUBE") return <YouTubePlayer lesson={lesson} onPosition={onPosition} onProgress={onProgress} />;
  return <video controls playsInline src={lesson.media_url} className="aspect-video w-full bg-black object-contain" onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(lesson.position_seconds, event.currentTarget.duration || lesson.position_seconds); onPosition(lesson.position_seconds); }} onTimeUpdate={(event) => { const position = Math.floor(event.currentTarget.currentTime); onPosition(position); if (position - lastReported.current >= 15) { lastReported.current = position; onProgress(position); } }} onPause={(event) => onProgress(Math.floor(event.currentTarget.currentTime))} onEnded={() => onProgress(lesson.duration_seconds)} />;
}

function YouTubePlayer({ lesson, onPosition, onProgress }: { lesson: CourseLesson; onPosition: (position: number) => void; onProgress: (position: number) => void }) {
  const playerMountRef = useRef<HTMLDivElement>(null);
  const positionRef = useRef(lesson.position_seconds);
  const positionCallback = useRef(onPosition);
  const progressCallback = useRef(onProgress);

  useEffect(() => {
    positionCallback.current = onPosition;
    progressCallback.current = onProgress;
  }, [onPosition, onProgress]);

  useEffect(() => {
    const mount = playerMountRef.current;
    const videoId = lesson.media_url?.split("/embed/")[1]?.split(/[?&]/)[0];
    if (!mount || !videoId) return;
    let player: YouTubePlayerInstance | null = null;
    let timer: number | null = null;
    let disposed = false;

    void loadYouTubeApi().then((YT) => {
      if (disposed || !playerMountRef.current) return;
      player = new YT.Player(playerMountRef.current, {
        videoId,
        host: "https://www.youtube-nocookie.com",
        playerVars: { playsinline: 1, start: Math.floor(lesson.position_seconds) },
        events: {
          onReady: ({ target }) => {
            if (lesson.position_seconds > 0) target.seekTo(lesson.position_seconds, true);
            positionCallback.current(lesson.position_seconds);
          },
          onStateChange: ({ data, target }) => {
            positionRef.current = Math.floor(target.getCurrentTime());
            positionCallback.current(positionRef.current);
            if (data === 0) progressCallback.current(lesson.duration_seconds);
          },
        },
      });
      timer = window.setInterval(() => {
        if (!player) return;
        positionRef.current = Math.floor(player.getCurrentTime());
        positionCallback.current(positionRef.current);
        progressCallback.current(positionRef.current);
      }, 15_000);
    });

    return () => {
      disposed = true;
      if (timer !== null) window.clearInterval(timer);
      if (positionRef.current > lesson.position_seconds) progressCallback.current(positionRef.current);
      player?.destroy();
    };
  }, [lesson]);

  // The YouTube API replaces its mount element with an iframe. Keep that node
  // inside a React-owned wrapper so lesson changes never make React remove a
  // child that the third-party player has already replaced.
  return <div className="aspect-video w-full bg-black [&>iframe]:h-full [&>iframe]:w-full" aria-label={stripOrdinal(lesson.title)}><div ref={playerMountRef} /></div>;
}

type YouTubePlayerInstance = {
  getCurrentTime: () => number;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  destroy: () => void;
};

type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      host: string;
      playerVars: { playsinline: number; start: number };
      events: {
        onReady: (event: { target: YouTubePlayerInstance }) => void;
        onStateChange: (event: { data: number; target: YouTubePlayerInstance }) => void;
      };
    },
  ) => YouTubePlayerInstance;
};

let youtubeApiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi() {
  const youtubeWindow = window as Window & {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  };
  if (youtubeWindow.YT?.Player) return Promise.resolve(youtubeWindow.YT);
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise<YouTubeApi>((resolve) => {
    const previousReady = youtubeWindow.onYouTubeIframeAPIReady;
    youtubeWindow.onYouTubeIframeAPIReady = () => {
      previousReady?.();
      if (youtubeWindow.YT) resolve(youtubeWindow.YT);
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      document.head.appendChild(script);
    }
  });
  return youtubeApiPromise;
}
