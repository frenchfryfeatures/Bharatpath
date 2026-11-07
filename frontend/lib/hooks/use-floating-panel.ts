"use client";

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from "react";
import { floatingPosition, type FloatingPosition } from "@/lib/ui/floating-position";

/** Portalled panels follow their trigger without inheriting ancestor clipping. */
export function useFloatingPanel(
  open: boolean,
  anchor: RefObject<HTMLElement | null>,
  panel: RefObject<HTMLElement | null>,
  { width, maxHeight, align = "left" }: { width?: number; maxHeight?: number; align?: "left" | "right" } = {},
): CSSProperties {
  const [position, setPosition] = useState<FloatingPosition | null>(null);
  useLayoutEffect(() => {
    if (!open) return;
    let frame = 0;
    const update = () => {
      const trigger = anchor.current;
      const element = panel.current;
      if (!trigger || !element) return;
      const viewport = window.visualViewport;
      const next = floatingPosition(trigger.getBoundingClientRect(), element.scrollHeight, {
        left: viewport?.offsetLeft ?? 0, top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? document.documentElement.clientWidth,
        height: viewport?.height ?? window.innerHeight,
      }, { width, maxHeight, align });
      setPosition((previous) => previous && Object.keys(next).every((key) => previous[key as keyof FloatingPosition] === next[key as keyof FloatingPosition]) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    schedule();
    const observer = new ResizeObserver(schedule);
    if (anchor.current) observer.observe(anchor.current);
    if (panel.current) observer.observe(panel.current);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [open, anchor, panel, width, maxHeight, align]);
  return { position: "fixed", minWidth: 0, ...position, visibility: position ? "visible" : "hidden" };
}
