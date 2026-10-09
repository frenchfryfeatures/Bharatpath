"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { StudentScore } from "@/features/student/types";

interface ScoreSnapshot {
  value: number;
  computedAt: string | null;
  previousValue: number | null;
}

function readSnapshot(key: string): ScoreSnapshot | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;

    const snapshot: unknown = JSON.parse(raw);
    if (
      typeof snapshot !== "object" ||
      snapshot === null ||
      !("value" in snapshot) ||
      !Number.isFinite(snapshot.value) ||
      !("computedAt" in snapshot) ||
      (snapshot.computedAt !== null && typeof snapshot.computedAt !== "string") ||
      !("previousValue" in snapshot) ||
      (snapshot.previousValue !== null && !Number.isFinite(snapshot.previousValue))
    ) {
      return null;
    }

    return snapshot as ScoreSnapshot;
  } catch {
    return null;
  }
}

function previousValue(
  saved: ScoreSnapshot | null,
  value: number,
  computedAt: string | null,
): number | null {
  if (saved?.value === value && saved.computedAt === computedAt) {
    return saved.previousValue;
  }
  return saved && saved.value !== value ? saved.value : null;
}

function isStoredScoreNewer(saved: ScoreSnapshot | null, computedAt: string | null) {
  if (!saved?.computedAt || !computedAt) return false;
  return Date.parse(saved.computedAt) > Date.parse(computedAt);
}

const subscribe = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

const getServerSnapshot = () => null;

/** Compares this score with the last score this browser saw for this student. */
export function useScoreChange(
  userId: string | undefined,
  score: StudentScore | undefined,
): number | null {
  const value = score?.status === "READY" ? score.value : null;
  const computedAt = score?.computedAt ?? null;
  const key = userId ? `bharatpath:student-score:${userId}` : null;

  const getSnapshot = useCallback(() => {
    if (!key || value == null) return null;
    const saved = readSnapshot(key);
    if (isStoredScoreNewer(saved, computedAt)) return null;
    const previous = previousValue(saved, value, computedAt);
    const points = previous == null ? null : value - previous;
    return points === 0 ? null : points;
  }, [key, value, computedAt]);

  const change = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    if (!key || value == null) return;

    const saved = readSnapshot(key);
    if (isStoredScoreNewer(saved, computedAt)) return;
    if (saved?.value === value && saved.computedAt === computedAt) return;

    try {
      window.localStorage.setItem(
        key,
        JSON.stringify({
          value,
          computedAt,
          previousValue: previousValue(saved, value, computedAt),
        } satisfies ScoreSnapshot),
      );
    } catch {
      // Storage is optional; without it there is no earlier score to compare.
    }
  }, [key, value, computedAt]);

  return change;
}
