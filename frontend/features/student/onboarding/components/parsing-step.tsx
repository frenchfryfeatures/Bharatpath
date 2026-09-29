"use client";

import { useEffect, useState } from "react";
import { Circle, FileText, Loader2, TriangleAlert } from "lucide-react";

import {
  useGetResumeFileStatusQuery,
  useGetResumeVersionQuery,
  type ResumeSection,
} from "@/store/student";

import { parseFailureMessage } from "../constants";
import { Card, DoneDot, ErrorNote, PillButton, StepHeader } from "./ui";

export type UploadPhase = "uploading" | "checking" | "reading";

interface ParsingStepProps {
  fileName: string;
  fileSize: number;
  phase: UploadPhase;
  resumeFileId?: string;
  /** The upload could not be checked; `onRetry` checks it again. */
  error?: string;
  onRetry?: () => void;
  onReview: (resumeVersionId: string) => void;
  onTryAnother: () => void;
  onPaste: () => void;
}

const LONG_WAIT_SECONDS = 45;

function formatSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

interface ChecklistRow {
  label: string;
  result: string | null;
}

function linesIn(sections: ResumeSection[], kinds: ResumeSection["kind"][]): number {
  return sections
    .filter((section) => kinds.includes(section.kind))
    .flatMap((section) => section.body.split("\n"))
    .filter((line) => line.trim()).length;
}

function itemsIn(sections: ResumeSection[], kind: ResumeSection["kind"]): number {
  return sections
    .filter((section) => section.kind === kind)
    .reduce((total, section) => total + (section.items?.length ?? 0), 0);
}

/** What the finished parse actually found, section by section. */
function checklist(sections: ResumeSection[] | null | undefined): ChecklistRow[] {
  const rows: Array<{ label: string; count: (s: ResumeSection[]) => number; unit?: boolean }> = [
    { label: "Contact details", count: (s) => linesIn(s, ["header"]) },
    { label: "Education", count: (s) => linesIn(s, ["education"]) },
    { label: "Experience", count: (s) => linesIn(s, ["experience", "summary"]) },
    { label: "Skills and projects", count: (s) => itemsIn(s, "skills") + linesIn(s, ["projects"]), unit: true },
    { label: "Certificates", count: (s) => itemsIn(s, "certifications"), unit: true },
  ];

  return rows.map((row) => {
    if (!sections) return { label: row.label, result: null };
    const found = row.count(sections);
    return {
      label: row.label,
      result: found === 0 ? "not found" : row.unit ? `${found} found` : "found",
    };
  });
}

/* -------------------------------------------------------------------------
 * 05 Parsing - upload, then poll the file until the parse is terminal.
 * ---------------------------------------------------------------------- */
export function ParsingStep({
  fileName,
  fileSize,
  phase,
  resumeFileId,
  error,
  onRetry,
  onReview,
  onTryAnother,
  onPaste,
}: Readonly<ParsingStepProps>) {
  const [stopPolling, setStopPolling] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [cursor, setCursor] = useState(0);

  const status = useGetResumeFileStatusQuery(resumeFileId ?? "", {
    skip: !resumeFileId,
    pollingInterval: stopPolling ? 0 : 2000,
    skipPollingIfUnfocused: false,
  });

  if (status.data?.terminal && !stopPolling) {
    setStopPolling(true);
  }

  const versionId =
    status.data?.parseStatus === "DONE" ? status.data.resumeVersionId : null;
  const version = useGetResumeVersionQuery(versionId ?? "", { skip: !versionId });

  const failed =
    status.data?.terminal && status.data.parseStatus !== "DONE" ? status.data : null;
  const finished = Boolean(versionId && version.data);
  // The parse is done once there is a version; loading its details for the
  // checklist is a nicety, and a failure there must not strand anyone.
  const readable = Boolean(versionId) && (finished || version.isError);

  useEffect(() => {
    if (readable || failed || error) return;
    const timer = window.setInterval(() => {
      setElapsed((seconds) => seconds + 1);
      setCursor((index) => (index + 1) % 5);
    }, 1400);
    return () => window.clearInterval(timer);
  }, [readable, failed, error]);

  const rows = checklist(finished ? version.data?.sections : undefined);
  // A structured version never reaches this screen, so no sections means
  // nothing recognisable was found - still worth showing the candidate.
  const foundCount = rows.filter((row) => row.result && row.result !== "not found").length;

  const phaseLabel =
    phase === "uploading"
      ? "uploading"
      : phase === "checking"
        ? "checking the file"
        : readable
          ? "read"
          : "reading";

  return (
    <div className="flex flex-col gap-5">
      <StepHeader
        title="Reading your resume"
        subtitle="This takes about ten seconds. Nothing is scored until you confirm it."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      {failed && (
        <ErrorNote>
          {failed.parseStatus === "BLOCKED"
            ? "This file was held by our safety check, so we could not read it. Try a different file, or paste the text instead."
            : parseFailureMessage(failed.parseErrorCode)}
        </ErrorNote>
      )}

      {status.isError && !failed && (
        <ErrorNote>We lost track of your upload. Try uploading it again.</ErrorNote>
      )}

      <Card className="flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3.5">
          <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-[#E7E3F6]">
            <FileText className="h-[18px] w-[18px] text-[#5E4DB2]" aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-[14px] font-semibold leading-5 text-[#0A1931]">
              {fileName}
            </span>
            <span className="text-[12px] leading-4 text-[#5F6B80]">
              {formatSize(fileSize)} · {phaseLabel}
            </span>
          </span>
          {finished && (
            <span className="flex-none text-[12px] font-bold text-[#0A1931]">
              {foundCount} / {rows.length}
            </span>
          )}
        </div>

        <div className="relative h-[3px] flex-none overflow-hidden bg-[#F0EBDF]" aria-hidden="true">
          {finished ? (
            <div className="absolute inset-0 bg-[#5F4DB2]" />
          ) : failed ? (
            <div className="absolute inset-0 bg-[#993A22]" />
          ) : (
            <div className="absolute inset-y-0 left-0 w-1/3 animate-[bpSweep_1.4s_ease-in-out_infinite] bg-[#5F4DB2]" />
          )}
        </div>

        <ul className="m-0 flex list-none flex-col p-0" aria-live="polite">
          {rows.map((row, index) => {
            const active = !readable && !failed && !error && index === cursor;

            return (
              <li
                key={row.label}
                className={`flex items-center gap-3 px-4 py-3.5 ${
                  index > 0 ? "border-t border-[#F7EFD6]" : ""
                } ${active ? "bg-[#F7EFD6]" : ""} ${
                  !finished && !active ? "opacity-60" : ""
                }`}
              >
                {finished ? (
                  row.result === "not found" ? (
                    <TriangleAlert className="h-3.5 w-3.5 flex-none text-[#7A5C0E]" aria-hidden="true" />
                  ) : (
                    <DoneDot />
                  )
                ) : active ? (
                  <Loader2 className="h-5 w-5 flex-none animate-spin text-[#0A1931]" aria-hidden="true" />
                ) : (
                  <Circle className="h-5 w-5 flex-none text-[#C6BFAF]" aria-hidden="true" />
                )}
                <span className="flex-1 text-[15px] font-medium leading-5 text-[#0A1931]">
                  {row.label}
                </span>
                <span className="text-[12px] leading-4 text-[#5F6B80]">
                  {finished ? row.result : active ? "reading" : ""}
                </span>
              </li>
            );
          })}
        </ul>
      </Card>

      {!readable && !failed && elapsed * 1.4 > LONG_WAIT_SECONDS && (
        <p className="m-0 rounded-[16px] bg-[#F7F4EC] px-4 py-3 text-[13px] leading-5 text-[#3A4761]">
          This is taking longer than usual. You can keep waiting, or{" "}
          <button
            type="button"
            onClick={onPaste}
            className="cursor-pointer font-semibold text-[#5F4DB2] underline underline-offset-2 transition-colors hover:text-[#4A3E8F]"
          >
            paste the text instead
          </button>
          .
        </p>
      )}

      <div className="flex flex-col gap-3">
        {error ? (
          <div className="flex gap-2">
            <PillButton variant="secondary" onClick={onTryAnother} className="flex-1">
              Try another file
            </PillButton>
            {onRetry && (
              <PillButton onClick={onRetry} className="flex-1">
                Try again
              </PillButton>
            )}
          </div>
        ) : failed || status.isError ? (
          <div className="flex gap-2">
            <PillButton variant="secondary" onClick={onPaste} className="flex-1">
              Paste text instead
            </PillButton>
            <PillButton onClick={onTryAnother} className="flex-1">
              Try another file
            </PillButton>
          </div>
        ) : (
          <PillButton
            onClick={() => versionId && onReview(versionId)}
            disabled={!readable}
            className="w-full py-[18px]"
          >
            {readable ? "Review what we found" : "Reading…"}
          </PillButton>
        )}
      </div>
    </div>
  );
}
