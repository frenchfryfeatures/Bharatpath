"use client";

import { useState } from "react";
import { Download, ExternalLink, FileText, RotateCw } from "lucide-react";

import { StructuredResumeUnavailable, StructuredResumeView, type StructuredResume } from "@/components/resume/structured-resume";
import type { RevealedCandidateResponse } from "@/store/employer/candidates";

export interface ResumeShowcaseProps {
  resume?: RevealedCandidateResponse["resume"] | null;
  currentTime?: number;
  onRefresh?: () => void;
}

function humanise(value: string) {
  return value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function ResumeShowcase({ resume, currentTime, onRefresh }: ResumeShowcaseProps) {
  const [mountedAt] = useState(() => Date.now());
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const now = currentTime ?? mountedAt;

  if (!resume) {
    return <p className="mt-3 rounded-lg border border-dashed border-[#dfe4ec] bg-[#fafbfc] px-3 py-3 text-[12px] text-[#7b8494]">No confirmed resume is available.</p>;
  }

  const isExpired = Boolean(resume.file_url_expires_at && Date.parse(resume.file_url_expires_at) <= now);
  const stored = resume.fields?.structured_resume;
  const storedResume = stored && typeof stored === "object" && "status" in stored && stored.status === "READY" && "data" in stored && stored.data && typeof stored.data === "object"
    ? stored.data as StructuredResume
    : null;
  const structured = resume.structured_status === "READY" ? resume.structured_resume : storedResume;
  const confirmedAt = resume.confirmed_at ? new Date(resume.confirmed_at) : null;

  const downloadResume = async () => {
    if (!resume.file_url || isDownloading) return;
    setIsDownloading(true);
    setDownloadError(false);
    try {
      const response = await fetch(resume.file_url);
      if (!response.ok) throw new Error("Resume download failed");
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = resume.file_mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ? "resume.docx" : "resume.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch {
      setDownloadError(true);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <section className="mt-3 overflow-hidden rounded-xl border border-[#dfe4ea] bg-white shadow-[0_2px_10px_rgba(23,32,51,0.04)]" aria-label="Candidate resume">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e7e9ee] bg-[#f8fafc] px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#eaf0f9] text-[#315c9f]"><FileText className="h-4 w-4" aria-hidden="true" /></span>
          <div className="min-w-0">
            <h3 className="text-[14px] font-semibold text-[#172033]">Resume details</h3>
            <p className="mt-0.5 text-[11px] text-[#687182]">{confirmedAt && !Number.isNaN(confirmedAt.getTime()) ? `Confirmed ${confirmedAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : "Candidate resume"}</p>
          </div>
          <span className="rounded-full bg-[#eef3fb] px-2.5 py-1 text-[10px] font-bold text-[#315c9f]">Source: {humanise(resume.source)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {resume.file_url && !isExpired && (
            <>
              <a href={resume.file_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-lg border border-[#d5dfee] bg-white px-3 py-2 text-[12px] font-semibold text-[#315c9f] hover:bg-[#eef3fb]">
                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Open resume
              </a>
              <button type="button" onClick={() => void downloadResume()} disabled={isDownloading} className="inline-flex items-center gap-1.5 rounded-lg bg-[#315c9f] px-3 py-2 text-[12px] font-semibold text-white hover:bg-[#284d86] disabled:cursor-wait disabled:opacity-60">
                <Download className="h-3.5 w-3.5" aria-hidden="true" /> {isDownloading ? "Downloading…" : "Download"}
              </button>
            </>
          )}
          {resume.file_url && isExpired && onRefresh && (
            <button type="button" onClick={onRefresh} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d5dfee] bg-white px-3 py-2 text-[12px] font-semibold text-[#315c9f] hover:bg-[#eef3fb]">
              <RotateCw className="h-3.5 w-3.5" aria-hidden="true" /> Refresh resume link
            </button>
          )}
        </div>
      </div>
      <div className="bg-[#fbfcfe] p-3 sm:p-4">
        {downloadError && <p role="alert" className="mb-3 text-[12px] text-[#b42318]">The download failed. Try again or open the resume.</p>}
        {structured
          ? <StructuredResumeView resume={structured} />
          : <StructuredResumeUnavailable status={resume.structured_status} />}
      </div>
    </section>
  );
}
