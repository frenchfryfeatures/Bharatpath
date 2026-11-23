export function jobCarouselLayout(availableWidth: number, fontScale = 1) {
  const scale = Math.max(1, fontScale);
  const header = Math.max(48, 60 * scale);
  const status = 17 * scale + 12;
  const metadata = 36 * scale;
  const skills = 32 * scale + 26;
  const footer = 16 * scale + 13;
  return {
    // 12px between cards and a 52px glimpse of the next card.
    width: Math.min(340, Math.max(1, availableWidth - 12 - 52)),
    height: 38 + 4 * 16 + header + status + metadata + skills + footer,
    header, status, metadata, skills, footer,
  };
}

export type JobCarouselLayout = ReturnType<typeof jobCarouselLayout>;
