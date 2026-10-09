export interface ScoreBand {
  label: string;
  background: string;
  color: string;
}

const BANDS: Record<string, ScoreBand> = {
  STRONG: { label: "Strong", background: "#eef8f3", color: "#16845d" },
  SOLID: { label: "Solid", background: "#edf3fb", color: "#28578f" },
  DEVELOPING: { label: "Developing", background: "#f3f4f7", color: "#596579" },
  ENTRY: { label: "Entry", background: "#f5f1e8", color: "#8b6b25" },
};

/** Same cut-offs as the API: Entry 700-769, Developing 770-819, Solid 820-864, Strong 865-990. */
function bandFromScore(score: number): string {
  if (score >= 865) return "STRONG";
  if (score >= 820) return "SOLID";
  if (score >= 770) return "DEVELOPING";
  return "ENTRY";
}

/** The band the API reported; the score is only a fallback when it sent none. */
export function getScoreBand(band: string | null | undefined, score?: number | null): ScoreBand {
  const key = band?.toUpperCase() ?? (typeof score === "number" ? bandFromScore(score) : "");
  return (
    BANDS[key] ?? { label: "Profile not opened", background: "#f0f2f5", color: "#687384" }
  );
}
