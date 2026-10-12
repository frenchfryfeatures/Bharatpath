/**
 * BharatPath - useScoreChange hook
 *
 * Compares the candidate's current score with the previous score recorded on
 * this device. Matches the web implementation in
 * `frontend/features/student/home/use-score-change.ts`.
 *
 * Product invariant:
 * The backend API deliberately returns only the current score (`GET /candidate/score/me`)
 * and never returns deltas or explanations. The delta is tracked client-side
 * relative to the prior score seen on the device.
 */
import { useEffect, useState, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CandidateScoreResponse } from '@/services/api/scoring';

interface ScoreSnapshot {
  value: number;
  computedAt: string | null;
  previousValue: number | null;
}

function snapshotStorageKey(userId?: string | null): string | null {
  if (!userId) return null;
  return `@bharatpath:student_score_snapshot:${userId}`;
}

function calculatePreviousValue(
  saved: ScoreSnapshot | null,
  value: number,
  computedAt: string | null,
): number | null {
  if (saved?.value === value && saved.computedAt === computedAt) {
    return saved.previousValue;
  }
  return saved && saved.value !== value ? saved.value : null;
}

function isStoredScoreNewer(saved: ScoreSnapshot | null, computedAt: string | null): boolean {
  if (!saved?.computedAt || !computedAt) return false;
  return Date.parse(saved.computedAt) > Date.parse(computedAt);
}

export function useScoreChange(
  userId: string | undefined | null,
  score: CandidateScoreResponse | null | undefined,
): number | null {
  const [scoreChange, setScoreChange] = useState<number | null>(null);
  const isMountedRef = useRef(true);

  const value = score?.status === 'READY' && score.value != null ? score.value : null;
  const computedAt = score?.computed_at ?? null;
  const storageKey = snapshotStorageKey(userId);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const numericValue = value;
    if (!storageKey || numericValue == null) {
      setScoreChange(null);
      return;
    }
    const scoreVal: number = numericValue;

    let isEffectValid = true;

    async function evaluateScoreChange() {
      try {
        const raw = await AsyncStorage.getItem(storageKey!);
        if (!isEffectValid || !isMountedRef.current) return;

        let saved: ScoreSnapshot | null = null;
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            if (
              typeof parsed === 'object' &&
              parsed !== null &&
              typeof parsed.value === 'number' &&
              Number.isFinite(parsed.value)
            ) {
              saved = parsed as ScoreSnapshot;
            }
          } catch {
            saved = null;
          }
        }

        if (isStoredScoreNewer(saved, computedAt)) {
          setScoreChange(null);
          return;
        }

        const prev = calculatePreviousValue(saved, scoreVal, computedAt);
        const delta = prev == null ? null : scoreVal - prev;
        const finalChange = delta === 0 ? null : delta;

        setScoreChange(finalChange);

        // Update stored snapshot if changed
        if (!(saved?.value === scoreVal && saved.computedAt === computedAt)) {
          const newSnapshot: ScoreSnapshot = {
            value: scoreVal,
            computedAt,
            previousValue: prev,
          };
          await AsyncStorage.setItem(storageKey!, JSON.stringify(newSnapshot));
        }
      } catch (err) {
        console.warn('[useScoreChange] Failed to read or update score snapshot:', err);
      }
    }

    evaluateScoreChange();

    return () => {
      isEffectValid = false;
    };
  }, [storageKey, value, computedAt]);

  return scoreChange;
}
