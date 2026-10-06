"use client";

import { useState } from "react";
import {
  AlignLeft,
  Download,
  ExternalLink,
  FileText,
  Maximize2,
  Minimize2,
  RotateCw,
} from "lucide-react";

import type { RevealedCandidateResponse } from "@/store/employer/candidates";

export interface ResumeShowcaseProps {
  resume?: RevealedCandidateResponse["resume"] | null;
  candidateName?: string;
  currentTime?: number;
  onRefresh?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

function ResumeFields({ value }: { value: unknown }) {
  if (!value || typeof value !== "object") {
    return (
      <span className="text-[12px] text-[#43516a]">
        {String(value ?? "—")}
      </span>
    );
  }
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc space-y-1 pl-4 text-[12px] text-[#43516a]">
        {value.map((item, index) => (
          <li key={index}>
            <ResumeFields value={item} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="space-y-2">
      {Object.entries(value).map(([key, item]) => (
        <div key={key}>
          <dt className="text-[12px] font-semibold capitalize text-[#273142]">
            {key.replaceAll("_", " ")}
          </dt>
          <dd className="mt-1 pl-2">
            <ResumeFields value={item} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function ResumeShowcase({
  resume,
  candidateName = "Candidate",
  currentTime,
  onRefresh,
  isExpanded = false,
  onToggleExpand,
}: ResumeShowcaseProps) {
  // Read the clock once, at mount: calling it on every render is impure.
  const [mountedAt] = useState(() => Date.now());
  const now = currentTime ?? mountedAt;
  const hasFile = Boolean(resume?.file_url);
  const isExpired = Boolean(
    resume?.file_url_expires_at &&
      Date.parse(resume.file_url_expires_at) <= now,
  );

  const hasParsed = Boolean(
    (resume?.sections && resume.sections.length > 0) ||
      resume?.text ||
      (resume?.fields && Object.keys(resume.fields).length > 0),
  );

  // Default to original document view whenever the file is available and valid
  const [viewMode, setViewMode] = useState<"original" | "parsed">("original");

  if (!resume) {
    return (
      <p className="mt-3 rounded-lg border border-dashed border-[#dfe4ec] bg-[#fafbfc] px-3 py-3 text-[12px] text-[#7b8494]">
        No confirmed resume is available.
      </p>
    );
  }

  const effectiveMode = hasFile && !isExpired ? viewMode : "parsed";

  return (
    <div className="mt-3 flex flex-col overflow-hidden rounded-xl border border-[#dfe4ea] bg-white shadow-sm">
      {/* Toolbar / Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e5e9f0] bg-[#f8fafc] px-3.5 py-2.5">
        {/* Left: View Mode Pills or Badge */}
        <div className="flex items-center gap-2">
          {hasFile && hasParsed && !isExpired ? (
            <div className="inline-flex items-center rounded-lg border border-[#dce3ec] bg-[#edf2f7] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setViewMode("original")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  effectiveMode === "original"
                    ? "bg-white text-[#111827] shadow-sm"
                    : "text-[#64748b] hover:text-[#111827]"
                }`}
              >
                <FileText className="h-3.5 w-3.5 text-[#3566b8]" />
                Original Document
              </button>
              <button
                type="button"
                onClick={() => setViewMode("parsed")}
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                  effectiveMode === "parsed"
                    ? "bg-white text-[#111827] shadow-sm"
                    : "text-[#64748b] hover:text-[#111827]"
                }`}
              >
                <AlignLeft className="h-3.5 w-3.5 text-[#64748b]" />
                Parsed Text
              </button>
            </div>
          ) : hasFile && !isExpired ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eff4fc] px-2.5 py-1 text-xs font-semibold text-[#295294]">
              <FileText className="h-3.5 w-3.5 text-[#3566b8]" />
              Original Resume Document
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs font-semibold text-[#475569]">
              <AlignLeft className="h-3.5 w-3.5 text-[#64748b]" />
              Parsed Resume Content
            </span>
          )}
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          {hasFile && isExpired && onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#fecdca] bg-[#fef3f2] px-2.5 py-1 text-xs font-semibold text-[#b42318] hover:bg-[#fee4e2] transition"
            >
              <RotateCw className="h-3 w-3" />
              Refresh link
            </button>
          )}

          {hasFile && !isExpired && (
            <>
              {onToggleExpand && (
                <button
                  type="button"
                  onClick={onToggleExpand}
                  title={
                    isExpanded
                      ? "Collapse drawer width"
                      : "Expand drawer for a wider document view"
                  }
                  className="inline-flex items-center gap-1 rounded-lg border border-[#dce3ec] bg-white px-2 py-1 text-xs font-medium text-[#475467] hover:bg-[#f1f5f9] transition"
                >
                  {isExpanded ? (
                    <>
                      <Minimize2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Standard</span>
                    </>
                  ) : (
                    <>
                      <Maximize2 className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">Expand</span>
                    </>
                  )}
                </button>
              )}

              <a
                href={resume.file_url!}
                target="_blank"
                rel="noopener noreferrer"
                title="Open original document in a new browser tab"
                className="inline-flex items-center gap-1 rounded-lg border border-[#dce3ec] bg-white px-2.5 py-1 text-xs font-medium text-[#475467] hover:bg-[#f1f5f9] hover:text-[#111827] transition"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                <span>Open in new tab</span>
              </a>

              <a
                href={resume.file_url!}
                download
                target="_blank"
                rel="noopener noreferrer"
                title="Download original resume file"
                className="inline-flex items-center gap-1 rounded-lg bg-[#3566b8] px-2.5 py-1 text-xs font-semibold text-white shadow-sm hover:bg-[#285299] transition"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download</span>
              </a>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {effectiveMode === "original" && hasFile && !isExpired ? (
        <div className="flex flex-col bg-[#525659]">
          <div className="relative h-[560px] w-full bg-[#525659]">
            <iframe
              src={resume.file_url!}
              title={`${candidateName}'s Original Resume`}
              className="h-full w-full border-0 bg-white"
            />
          </div>

          <div className="flex items-center justify-between border-t border-[#e2e8f0] bg-[#f8fafc] px-3.5 py-1.5 text-[11px] text-[#64748b]">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
              Original document preview
            </span>
            <a
              href={resume.file_url!}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[#3566b8] hover:underline"
            >
              Cannot see the document? Open in new tab →
            </a>
          </div>
        </div>
      ) : (
        <div className="bp-scrollbar max-h-[500px] overflow-y-auto p-4 space-y-4 bg-white">
          {resume.sections && resume.sections.length > 0 ? (
            resume.sections.map((section, index) => (
              <div
                key={`${section.kind}-${index}`}
                className="rounded-lg border border-[#eef2f6] bg-[#fbfcfd] p-3.5"
              >
                {section.heading ? (
                  <h4 className="mb-2 text-[13px] font-bold text-[#1f2937]">
                    {section.heading}
                  </h4>
                ) : null}
                <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[#43516a]">
                  {section.body}
                </p>
              </div>
            ))
          ) : resume.text ? (
            <div className="rounded-lg border border-[#eef2f6] bg-[#fbfcfd] p-3.5">
              <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[#43516a]">
                {resume.text}
              </p>
            </div>
          ) : resume.fields && Object.keys(resume.fields).length > 0 ? (
            <div className="rounded-lg border border-[#eef2f6] bg-[#fbfcfd] p-3.5">
              <ResumeFields value={resume.fields} />
            </div>
          ) : (
            <p className="rounded-lg border border-dashed border-[#dfe4ec] bg-[#fafbfc] px-3 py-3 text-[12px] text-[#7b8494]">
              No resume content is available.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
