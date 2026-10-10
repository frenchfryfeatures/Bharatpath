"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { Minus, Plus } from "lucide-react";

const SIZE = 512;

export function PhotoCropper({ file, busy, shape = "circle", onCancel, onSave }: {
  file: File;
  shape?: "circle" | "square";
  busy: boolean;
  onCancel: () => void;
  onSave: (file: File) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 });
  const disabled = busy || saving;

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const source = new Image();
    let active = true;
    source.onload = () => {
      if (!active) return;
      sourceRef.current = source;
      setReady(true);
    };
    source.onerror = () => {
      if (active) setError("Could not open this image. Please choose another photo.");
    };
    source.src = url;
    return () => { active = false; URL.revokeObjectURL(url); };
  }, [file]);

  useEffect(() => {
    const source = sourceRef.current;
    const context = canvasRef.current?.getContext("2d");
    if (!ready || !source || !context) return;
    const scale = Math.max(SIZE / source.naturalWidth, SIZE / source.naturalHeight) * zoom;
    const width = source.naturalWidth * scale;
    const height = source.naturalHeight * scale;
    context.fillStyle = "white";
    context.fillRect(0, 0, SIZE, SIZE);
    context.drawImage(source, -(width - SIZE) * position.x, -(height - SIZE) * position.y, width, height);
  }, [ready, zoom, position]);

  const save = async () => {
    setError("");
    setSaving(true);
    try {
      const canvas = canvasRef.current;
      if (!canvas) throw new Error("Missing crop preview");
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not crop photo")), "image/jpeg", 0.92);
      });
      await onSave(new File([blob], "profile-photo.jpg", { type: "image/jpeg" }));
    } catch {
      setError("Could not save the crop. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl bg-[var(--photo-surface)] p-5">
      <div className={`relative mx-auto w-full max-w-56 overflow-hidden bg-white ring-4 ring-white shadow-sm ${shape === "circle" ? "rounded-full" : "rounded-2xl"}`}>
        <canvas
          ref={canvasRef}
          width={SIZE}
          height={SIZE}
          aria-label={shape === "circle" ? "Profile photo crop preview" : "Logo crop preview"}
          tabIndex={0}
          aria-description="Drag to reposition, or use the arrow keys."
          className="block aspect-square w-full touch-none cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--photo-accent)] active:cursor-grabbing"
          onKeyDown={(event) => {
            if (!ready || disabled) return;
            const directions: Record<string, [number, number]> = {
              ArrowLeft: [-0.02, 0], ArrowRight: [0.02, 0], ArrowUp: [0, -0.02], ArrowDown: [0, 0.02],
            };
            const direction = directions[event.key];
            if (!direction) return;
            event.preventDefault();
            setPosition((current) => ({ x: Math.max(0, Math.min(1, current.x + direction[0])), y: Math.max(0, Math.min(1, current.y + direction[1])) }));
          }}
          onPointerDown={(event) => {
            if (!ready || disabled) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { x: event.clientX, y: event.clientY, left: position.x, top: position.y };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            const source = sourceRef.current;
            if (!drag || !source || disabled) return;
            const scale = Math.max(SIZE / source.naturalWidth, SIZE / source.naturalHeight) * zoom;
            const ratio = SIZE / event.currentTarget.getBoundingClientRect().width;
            const clamp = (value: number) => Math.max(0, Math.min(1, value));
            const horizontal = source.naturalWidth * scale - SIZE;
            const vertical = source.naturalHeight * scale - SIZE;
            setPosition({
              x: horizontal > 0 ? clamp(drag.left - (event.clientX - drag.x) * ratio / horizontal) : 0.5,
              y: vertical > 0 ? clamp(drag.top - (event.clientY - drag.y) * ratio / vertical) : 0.5,
            });
          }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
        />
      </div>
      <p className="mt-4 text-center text-[12px] text-[#7B8495]">Drag photo to reposition</p>
      </div>
      <div className="flex items-center gap-3 px-1 text-[#7B8495]">
        <Minus size={16} aria-hidden="true" />
        <input aria-label="Zoom" type="range" min={1} max={3} step="0.01" value={zoom} disabled={!ready || disabled} onChange={(event) => setZoom(Number(event.target.value))}
          style={{ background: `linear-gradient(to right, var(--photo-accent) ${(zoom - 1) * 50}%, var(--photo-track) ${(zoom - 1) * 50}%)` }}
          className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--photo-accent)] disabled:opacity-50 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:bg-[var(--photo-accent)] [&::-webkit-slider-thumb]:shadow-sm [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white [&::-moz-range-thumb]:bg-[var(--photo-accent)]" />
        <Plus size={16} aria-hidden="true" />
      </div>
      {error && <p role="alert" className="text-[12px] text-[#b42318]">{error}</p>}
      <div className="flex gap-3 border-t border-[var(--photo-track)] pt-4">
        <Button type="button" variant="ghost" className="!h-10 flex-1 !rounded-full" disabled={disabled} onClick={onCancel}>Cancel</Button>
        <Button type="button" className="!h-10 flex-1 !rounded-full !bg-[var(--photo-accent)] hover:!bg-[var(--photo-hover)]" disabled={!ready} isLoading={disabled} loadingText="Saving..." onClick={() => void save()}>{shape === "circle" ? "Save photo" : "Save logo"}</Button>
      </div>
    </div>
  );
}
