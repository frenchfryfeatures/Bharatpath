export type FloatingPosition = {
  left: number;
  top: number;
  width: number;
  maxHeight: number;
};

/** Keep overlays inside the visible viewport, including at browser zoom. */
export function floatingPosition(
  anchor: { left: number; right: number; top: number; bottom: number; width: number },
  panelHeight: number,
  viewport: { left: number; top: number; width: number; height: number },
  options: { width?: number; maxHeight?: number; align?: "left" | "right" } = {},
): FloatingPosition {
  const margin = Math.min(12, viewport.width / 4, viewport.height / 4);
  const gap = 6;
  const width = Math.max(0, Math.min(options.width ?? anchor.width, viewport.width - margin * 2));
  const minTop = viewport.top + margin;
  const maxBottom = viewport.top + viewport.height - margin;
  const below = Math.max(0, maxBottom - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - minTop);
  const desired = Math.min(panelHeight, options.maxHeight ?? Number.POSITIVE_INFINITY);
  const upwards = below < desired && above > below;
  let maxHeight = Math.min(options.maxHeight ?? Number.POSITIVE_INFINITY, upwards ? above : below, maxBottom - minTop);
  // A short viewport or on-screen keyboard may leave neither side usable.
  const fullViewport = maxHeight < Math.min(desired, 160);
  if (fullViewport) maxHeight = Math.min(options.maxHeight ?? Number.POSITIVE_INFINITY, maxBottom - minTop);
  const height = Math.min(panelHeight, maxHeight);
  const preferredTop = fullViewport ? minTop : upwards ? anchor.top - gap - height : anchor.bottom + gap;
  const preferredLeft = options.align === "right" ? anchor.right - width : anchor.left;
  return {
    left: Math.max(viewport.left + margin, Math.min(preferredLeft, viewport.left + viewport.width - margin - width)),
    top: Math.max(minTop, Math.min(preferredTop, maxBottom - height)),
    width,
    maxHeight: Math.max(0, maxHeight),
  };
}
