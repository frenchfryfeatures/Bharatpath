"use client";

import { useEffect, useRef, useState } from "react";

/*
 * ==========================================================================
 * SCORE MARKER (file name kept; it is no longer a ring)
 *
 * The counting number from the score-reveal beat with a position marker on
 * a neutral track. Never a gauge, dial or arc (design-system §1).
 * ==========================================================================
 */

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
/** How far below the final number the count-up animation starts. */
const COUNT_UP_SPAN = 120;

/** `min` and `max` come from `GET /candidate/score/scale`, never from here. */
export function ScoreRing({
  value,
  min,
  max,
  size = 190,
  onNavy = true,
  animate = true,
}: {
  value: number;
  min: number;
  max: number;
  size?: number;
  onNavy?: boolean;
  animate?: boolean;
}) {
  const fraction =
    max > min ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 1;
  const targetOffset = CIRCUMFERENCE * (1 - fraction);
  const countFrom = Math.max(min, value - COUNT_UP_SPAN);

  const [display, setDisplay] = useState(countFrom);
  const [offset, setOffset] = useState(CIRCUMFERENCE);
  const rafRef = useRef<number | null>(null);
  const shownDisplay = animate ? display : value;
  const shownOffset = animate ? offset : targetOffset;

  useEffect(() => {
    if (!animate) return;

    // Draw the arc after a short beat.
    const drawTimer = window.setTimeout(() => setOffset(targetOffset), 120);

    // Count the number up (~40 steps, ease-out).
    let current = countFrom;
    const tick = () => {
      current += Math.max(2, Math.round((value - current) / 6));
      if (current >= value) {
        current = value;
        setDisplay(current);
        return;
      }
      setDisplay(current);
      rafRef.current = window.setTimeout(tick, 32) as unknown as number;
    };
    const startTimer = window.setTimeout(tick, 200);

    return () => {
      window.clearTimeout(drawTimer);
      window.clearTimeout(startTimer);
      if (rafRef.current) window.clearTimeout(rafRef.current);
    };
  }, [animate, countFrom, targetOffset, value]);

  const position = `${(1 - shownOffset / CIRCUMFERENCE) * 100}%`;
  const track = onNavy ? "rgba(255,252,247,0.18)" : "#E4E0D4";

  return (
    <div
      className="flex flex-col items-center gap-3"
      style={{ width: Math.max(size, 220) }}
    >
      <span
        className={[
          "text-[64px] font-extrabold leading-[60px] tracking-[-0.05em]",
          onNavy ? "text-white" : "text-[#0A1931]",
        ].join(" ")}
      >
        {shownDisplay}
      </span>
      <div className="relative h-2 w-full rounded-full" style={{ background: track }}>
        <span
          className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[#D4AF37]"
          style={{
            left: position,
            transition: "left 1.3s cubic-bezier(.22,.85,.2,1)",
          }}
        />
      </div>
      <span
        className={[
          "text-[9px] font-semibold uppercase leading-3 tracking-[0.16em]",
          onNavy ? "text-[#9DA9BE]" : "text-[#5F6B80]",
        ].join(" ")}
      >
        {min} – {max}
      </span>
    </div>
  );
}
