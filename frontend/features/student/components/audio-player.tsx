"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCw, Volume2 } from "lucide-react";

const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/*
 * Replaces the browser's native <audio controls>, which draws a grey pill in
 * the OS's own colours. Same element underneath, so the recording behaves the
 * same; only the controls are ours.
 *
 * A freshly recorded MediaRecorder blob has no duration in its header and the
 * element reports Infinity until it has been played through, so the length
 * falls back to `knownDurationMs` (what the recorder measured) when given.
 */
export function StudentAudioPlayer(props: AudioPlayerProps) {
  // Keyed on the source so a new recording starts from a clean state.
  return <AudioPlayer key={props.src} {...props} />;
}

interface AudioPlayerProps {
  src: string;
  knownDurationMs?: number;
  label?: string;
  className?: string;
  /** Start on mount. A browser may refuse; the play button is then the way in. */
  autoPlay?: boolean;
  /** Titles the player and adds a replay button, as the interviewer's audio is on mobile. */
  heading?: string;
}

function AudioPlayer({
  src,
  knownDurationMs,
  label = "Recording",
  className = "",
  autoPlay = false,
  heading,
}: AudioPlayerProps) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [reported, setReported] = useState(0);

  useEffect(() => {
    const element = audio.current;
    if (!autoPlay || !element) return;
    void element.play().catch(() => undefined);
    return () => element.pause();
  }, [autoPlay]);

  const total = Number.isFinite(reported) && reported > 0 ? reported : (knownDurationMs ?? 0) / 1000;
  const progress = total > 0 ? Math.min(100, (current / total) * 100) : 0;

  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (element.paused) void element.play().catch(() => setPlaying(false));
    else element.pause();
  };

  const replay = () => {
    const element = audio.current;
    if (!element) return;
    element.currentTime = 0;
    void element.play().catch(() => setPlaying(false));
  };

  const seek = (value: number) => {
    const element = audio.current;
    if (!element || total <= 0) return;
    element.currentTime = (value / 100) * total;
    setCurrent(element.currentTime);
  };

  const slider = (
    <input
      type="range"
      min={0}
      max={100}
      step={0.1}
      value={progress}
      onChange={(event) => seek(Number(event.target.value))}
      aria-label={`${label} position`}
      disabled={total <= 0}
      className="h-1.5 min-w-0 flex-1 cursor-pointer accent-[#5F4DB2] disabled:cursor-default"
    />
  );

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-[#E7E0D4] bg-[#F7F4EC] px-3 py-2.5 ${className}`}
    >
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrent(0);
        }}
        onTimeUpdate={(event) => setCurrent(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setReported(event.currentTarget.duration)}
        onDurationChange={(event) => setReported(event.currentTarget.duration)}
      />

      <button
        type="button"
        onClick={toggle}
        aria-label={playing ? `Pause ${label}` : `Play ${label}`}
        className={`grid shrink-0 cursor-pointer place-items-center rounded-full bg-[#5F4DB2] text-white transition-colors hover:bg-[#4A3E8F] ${heading ? "h-11 w-11" : "h-9 w-9"}`}
      >
        {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" className="ml-0.5" />}
      </button>

      {heading ? (
        <>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <p className="flex items-center gap-1.5 text-[14px] font-semibold text-[#0A1931]">
              <Volume2 size={14} className="text-[#5F4DB2]" aria-hidden="true" />
              {heading}
            </p>
            {slider}
            <span className="font-mono text-[12px] tabular-nums text-[#5F6B80]">
              {clock(current)} / {clock(total)}
            </span>
          </div>
          <button
            type="button"
            onClick={replay}
            aria-label={`Replay ${label}`}
            className="grid h-10 w-10 shrink-0 cursor-pointer place-items-center rounded-full bg-[#ECE8F5] text-[#5F4DB2] transition-colors hover:bg-[#DFD8F0]"
          >
            <RotateCw size={16} />
          </button>
        </>
      ) : (
        <>
          {slider}
          <span className="shrink-0 text-[12px] tabular-nums text-[#5F6B80]">
            {clock(current)} / {clock(total)}
          </span>
        </>
      )}
    </div>
  );
}
