"use client";
/* eslint-disable @next/next/no-img-element -- Inline pages from the PDF renderer do not need image optimization. */
import { useRef, useState, type PointerEvent } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";

/** These are pages rendered from the exported PDF, not a separate resume layout. */
export function ResumePreviewViewer({ pages, mime = "image/png", truncated = false }: { pages: string[]; mime?: string; truncated?: boolean }) {
  const [zoom, setZoom] = useState(100);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const distance = () => {
    const [a, b] = [...touches.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  };
  const touchStart = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    if (touches.current.size >= 2) return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    event.currentTarget.setPointerCapture(event.pointerId);
    if (touches.current.size === 2) pinch.current = { distance: distance(), zoom };
  };
  const touchMove = (event: PointerEvent<HTMLDivElement>) => {
    const previous = touches.current.get(event.pointerId);
    if (!previous) return;
    touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.current.size === 2 && pinch.current && pinch.current.distance > 0) {
      setZoom(Math.round(Math.max(50, Math.min(300, pinch.current.zoom * distance() / pinch.current.distance))));
    } else if (touches.current.size === 1) {
      event.currentTarget.scrollLeft -= event.clientX - previous.x;
      event.currentTarget.scrollTop -= event.clientY - previous.y;
    }
  };
  const touchEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!touches.current.delete(event.pointerId)) return;
    pinch.current = null;
  };
  const control = "grid h-11 min-w-11 place-items-center rounded-xl text-[#5F4DB2] hover:bg-[#F1EAF7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30 disabled:opacity-40";
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center gap-2 border-b border-[#E7E0D4] bg-[#FFFCF7] py-1">
      <button type="button" aria-label="Zoom out" disabled={zoom <= 50} onClick={() => setZoom(value => Math.max(50, value - 25))} className={control}><Minus size={19}/></button>
      <span aria-live="polite" className="min-w-12 text-center text-sm text-[#5F4DB2]">{zoom}%</span>
      <button type="button" aria-label="Zoom in" disabled={zoom >= 300} onClick={() => setZoom(value => Math.min(300, value + 25))} className={control}><Plus size={19}/></button>
      <button type="button" aria-label="Fit resume to width" onClick={() => setZoom(100)} className={`${control} ml-auto flex gap-2 px-3 text-sm`}><Maximize2 size={17}/>Fit</button>
    </div>
    <div tabIndex={0} aria-label="Resume pages, pinch to zoom or scroll to explore the document" style={{ touchAction: 'none' }} onPointerDown={touchStart} onPointerMove={touchMove} onPointerUp={touchEnd} onPointerCancel={touchEnd} onLostPointerCapture={touchEnd} className="min-h-0 flex-1 overflow-auto overscroll-contain bg-[#EFEBE0] p-3">
      <div className="mx-auto flex flex-col gap-4" style={{ width: `${zoom}%`, minWidth: `${zoom}%` }}>
        {pages.map((page, index) => <div key={index}><p className="mb-2 text-xs text-[#5F6B80]">Page {index + 1} of {pages.length}{truncated ? "+" : ""}</p><img draggable={false} src={`data:${mime};base64,${page}`} alt={`Resume page ${index + 1}`} className="block w-full bg-white shadow-sm"/></div>)}
      </div>
      {truncated && <p className="mt-3 text-sm text-[#5F6B80]">The preview shows the first pages. Download the full resume to review all pages.</p>}
    </div>
  </div>;
}
