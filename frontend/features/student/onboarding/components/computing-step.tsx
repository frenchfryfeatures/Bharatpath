"use client";

import { useEffect, useState } from "react";
import { Circle, Loader2 } from "lucide-react";

import { getApiErrorStatus } from "@/lib/api/error-message";
import { useGetStudentScoreQuery } from "@/store/student";

import { COMPUTE_STATUS, SCORE_CATEGORIES } from "../constants";
import { Card, DoneDot, LockNote, PillButton, StepHeader } from "./ui";

/** After this long without a score, stop implying it is seconds away. */
const PATIENCE_SECONDS = 90;
const TICK_MS = 2200;

interface ComputingStepProps {
  /**
   * When the resume was confirmed. A score computed before this is the
   * previous version's, not the one being scored now.
   */
  confirmedAt: string | null;
  onShowScore: () => void;
  onGoHome: () => void;
}

/* -------------------------------------------------------------------------
 * 08 Computing - poll the score until the confirmed version has one.
 * ---------------------------------------------------------------------- */
export function ComputingStep({ confirmedAt, onShowScore, onGoHome }: Readonly<ComputingStepProps>) {
  const [ready, setReady] = useState(false);
  const [locked, setLocked] = useState(false);
  const [ticks, setTicks] = useState(0);

  const score = useGetStudentScoreQuery(undefined, {
    pollingInterval: ready || locked ? 0 : 3000,
    skipPollingIfUnfocused: false,
    refetchOnMountOrArgChange: true,
  });

  // The endpoint keeps answering with the previous version's score until the
  // new one lands, so only a score computed after this confirmation counts.
  const fresh =
    score.data?.status === "READY" &&
    (!confirmedAt ||
      (score.data.computedAt !== null &&
        new Date(score.data.computedAt).getTime() >= new Date(confirmedAt).getTime()));

  if (fresh && !ready) {
    setReady(true);
  }

  // Seeing the score is pay-first (R13): without a subscription or a college
  // seat the endpoint answers 402, and polling it again changes nothing.
  if (score.isError && getApiErrorStatus(score.error) === 402 && !locked) {
    setLocked(true);
  }

  useEffect(() => {
    if (ready || locked) return;
    const timer = window.setInterval(() => setTicks((count) => count + 1), TICK_MS);
    return () => window.clearInterval(timer);
  }, [ready, locked]);

  const slow = !ready && !locked && (ticks * TICK_MS) / 1000 >= PATIENCE_SECONDS;
  const current = ticks % SCORE_CATEGORIES.length;
  const status = ready
    ? "Your score is ready"
    : locked
      ? "Your resume is confirmed"
      : COMPUTE_STATUS[ticks % COMPUTE_STATUS.length];

  return (
    <div className="flex flex-col gap-4">
      <StepHeader title="Scoring your resume" subtitle="Same five categories for everyone." />

      <div className="flex flex-col gap-5 rounded-[24px] bg-[#5E4DB2] p-[22px]">
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase leading-3 tracking-[0.14em] text-[#E0DBF4]">
            {ready ? "Done" : locked ? "Saved" : "Working"}
          </span>
          <span
            key={status}
            className="truncate text-[19px] font-bold leading-[26px] tracking-[-0.02em] text-white motion-safe:animate-[bpFadeUp_.3s_ease]"
            aria-live="polite"
          >
            {status}
          </span>
        </div>
        <div className="flex flex-col gap-2">
          <div className="relative h-1.5 overflow-hidden rounded-full bg-white/20" aria-hidden="true">
            {ready || locked ? (
              <div className="absolute inset-0 rounded-full bg-[#FFFCF7]" />
            ) : (
              <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-[#FFFCF7] animate-[bpSweep_1.6s_ease-in-out_infinite]" />
            )}
          </div>
          <span className="text-[12px] font-semibold leading-4 tracking-[0.06em] text-[#DED9F3]">
            {ready ? `${SCORE_CATEGORIES.length} OF ${SCORE_CATEGORIES.length} CATEGORIES` : locked ? "SCORING STARTED" : "READING EVERY CATEGORY"}
          </span>
        </div>
      </div>

      <Card className="flex flex-col overflow-hidden">
        <ul className="m-0 flex list-none flex-col p-0">
          {SCORE_CATEGORIES.map((category, index) => {
            const active = !ready && !locked && index === current;

            return (
              <li
                key={category}
                className={`flex items-center gap-3 px-4 py-3 ${index > 0 ? "border-t border-[#F7EFD6]" : ""} ${
                  active ? "bg-[#F7EFD6]" : ""
                } ${!ready && !active ? "opacity-60" : ""}`}
              >
                {ready ? (
                  <DoneDot />
                ) : active ? (
                  <Loader2 className="h-5 w-5 flex-none animate-spin text-[#5E4DB2]" aria-hidden="true" />
                ) : (
                  <Circle className="h-5 w-5 flex-none text-[#C6BFAF]" aria-hidden="true" />
                )}
                <span className="flex-1 text-[15px] font-medium leading-5 text-[#0A1931]">{category}</span>
                {ready && <span className="text-[12px] leading-4 text-[#5F6B80]">scored</span>}
              </li>
            );
          })}
        </ul>
      </Card>

      {slow && (
        <p className="m-0 rounded-[16px] bg-[#F7F4EC] px-4 py-3 text-[13px] leading-5 text-[#3A4761]">
          This is taking longer than usual. Your resume is confirmed and saved —
          your score will appear on your home screen as soon as it is ready.
        </p>
      )}

      {locked && (
        <p className="m-0 rounded-[16px] bg-[#F7EFD6] px-4 py-3 text-[13px] leading-5 text-[#7A5C0E]">
          Your resume is confirmed and saved. Seeing your score needs an active
          subscription or a college seat — once you have one, it will be on
          your home screen.
        </p>
      )}

      <div className="sticky bottom-0 flex flex-col gap-3 bg-[#FFFCF7] pb-3.5 pt-3">
        {ready ? (
          <PillButton onClick={onShowScore} className="w-full py-[18px]">
            Show my score
          </PillButton>
        ) : locked ? (
          <PillButton onClick={onGoHome} className="w-full py-[18px]">
            Go to my home screen
          </PillButton>
        ) : (
          <>
            <PillButton disabled className="w-full py-[18px]">
              Scoring…
            </PillButton>
            {slow && (
              <PillButton variant="secondary" onClick={onGoHome} className="w-full">
                Go to my home screen
              </PillButton>
            )}
          </>
        )}
        <LockNote>Employers see it only if you apply.</LockNote>
      </div>
    </div>
  );
}
