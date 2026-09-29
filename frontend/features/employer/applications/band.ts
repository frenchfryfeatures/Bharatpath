export interface ScoreBand {
  label: string;
  background: string;
  color: string;
}

export function getScoreBand(score: number | null): ScoreBand {
  if (score === null) {
    return {
      label: "Profile not opened",
      background: "#f0f2f5",
      color: "#687384",
    };
  }

  if (score >= 900) {
    return {
      label: "Exceptional",
      background: "#eef8f3",
      color: "#16845d",
    };
  }

  if (score >= 800) {
    return {
      label: "Strong",
      background: "#edf3fb",
      color: "#28578f",
    };
  }

  if (score >= 700) {
    return {
      label: "Building",
      background: "#f5f1e8",
      color: "#8b6b25",
    };
  }

  return {
    label: "Developing",
    background: "#f3f4f7",
    color: "#687384",
  };
}
