import type { StudentScoreBand } from "@/store/college/students";

import type { ScoreBand } from "./types";

const BAND_MAP: Record<StudentScoreBand, ScoreBand> = {
  ENTRY: "building",
  DEVELOPING: "building",
  SOLID: "strong",
  STRONG: "exceptional",
};

export function mapScoreBand(
  band: StudentScoreBand | null,
): ScoreBand {
  return band ? BAND_MAP[band] : "not_scored";
}
