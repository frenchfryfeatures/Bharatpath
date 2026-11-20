/**
 * BharatPath - Candidate score
 * GET /candidate/score/me
 *
 * Confirming a resume only emits `resume.version_confirmed`. The number is
 * computed by a worker and this endpoint is how the app learns it. PENDING
 * is a normal 200, not a 404 - keep polling until READY.
 *
 * The response is the number and the band. Nothing here explains the score.
 */
import { apiRequest, ApiError } from './client';

export type ScoreStatus = 'READY' | 'PENDING';

export type ScoreBand = 'ENTRY' | 'DEVELOPING' | 'SOLID' | 'STRONG';

export interface CandidateScoreResponse {
  status: ScoreStatus;
  value: number | null;
  band: ScoreBand | string | null;
  computed_at: string | null;
}

export interface ScoreBandResponse {
  band: ScoreBand | string;
  lowest: number;
  highest: number;
}

export interface ScoreScaleResponse {
  lowest: number;
  highest: number;
  bands: ScoreBandResponse[];
}

export const UI_SCORE_MAX = 1000;

export async function getMyScore(): Promise<CandidateScoreResponse> {
  return apiRequest<CandidateScoreResponse>('/candidate/score/me');
}

export async function getScoreScale(): Promise<ScoreScaleResponse> {
  return apiRequest<ScoreScaleResponse>('/candidate/score/scale');
}

const BAND_LABELS: Record<string, string> = {
  ENTRY: 'Entry',
  DEVELOPING: 'Developing',
  SOLID: 'Solid',
  STRONG: 'Strong',
};

export const SCORE_BANDS: { code: ScoreBand; label: string; low: number; high: number }[] = [
  { code: 'ENTRY', label: 'Entry', low: 700, high: 769 },
  { code: 'DEVELOPING', label: 'Developing', low: 770, high: 819 },
  { code: 'SOLID', label: 'Solid', low: 820, high: 864 },
  { code: 'STRONG', label: 'Strong', low: 865, high: 1000 },
];

export function bandLabel(band: string | null | undefined): string {
  if (!band) return '';
  return BAND_LABELS[band] || band;
}

export function bandIndex(band: string | null | undefined): number {
  const idx = SCORE_BANDS.findIndex((row) => row.code === band);
  return idx >= 0 ? idx + 1 : 1;
}

export function pointsToNextBand(value: number | null, band: string | null): number | null {
  if (value == null || !band) return null;
  const idx = SCORE_BANDS.findIndex((row) => row.code === band);
  if (idx < 0 || idx === SCORE_BANDS.length - 1) return null;
  return SCORE_BANDS[idx + 1].low - value;
}

export function nextBandLabel(band: string | null): string | null {
  const idx = SCORE_BANDS.findIndex((row) => row.code === band);
  if (idx < 0 || idx === SCORE_BANDS.length - 1) return null;
  return SCORE_BANDS[idx + 1].label;
}

export function scoringErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === 'subscription_required') {
      return 'Membership is required to see your Bharatpath Score.';
    }
    if (error.status === 402) {
      return 'Membership is required to see your Bharatpath Score.';
    }
    return error.problem.title || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
