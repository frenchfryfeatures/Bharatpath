"use client";

/**
 * The candidate's resume as they provided it (2026-11-23).
 *
 * An uploaded resume reaches employers, colleges and staff **exactly as
 * uploaded**: a PDF is shown inline, page by page, in the browser's own
 * viewer. A resume built in the Bharatpath Builder is the PDF of the template
 * the candidate chose, so it is shown the same way. What we *read* from the
 * file (the structured details) is a separate thing -- parsing feeds scoring
 * and search -- and appears below, collapsed, never in place of the document.
 *
 * Falls back to the structured view when there is no file (a typed resume),
 * when the file is a Word document (browsers cannot draw one), or when the
 * file cannot be fetched.
 */
import { useEffect, useState } from "react";
import { ExternalLink, FileText, Loader2 } from "lucide-react";

import {
  StructuredResumeUnavailable,
  StructuredResumeView,
  type StructuredResume,
  type StructuredStatus,
} from "@/components/resume/structured-resume";

type FileState =
  | { kind: "loading" }
  | { kind: "pdf"; url: string }
  | { kind: "unviewable" };

async function startsWithPdfMagic(blob: Blob): Promise<boolean> {
  const head = new Uint8Array(await blob.slice(0, 5).arrayBuffer());
  return String.fromCharCode(...head) === "%PDF-";
}

type OriginalResumeProps = {
  fileUrl?: string | null;
  fileMime?: string | null;
  structured?: StructuredResume | null;
  structuredStatus?: StructuredStatus | string | null;
  height?: number;
};

export function OriginalResumeView(props: OriginalResumeProps) {
  // Renewing an S3 signature is a refresh of the same document, not a new CV.
  let identity = props.fileUrl ?? "none";
  try {
    const url = new URL(identity);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(x-amz-|awsaccesskeyid$|signature$|expires$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    identity = url.toString();
  } catch { /* Relative/non-URL sources retain their exact identity. */ }
  return <ResumeFileView key={`${identity}:${props.fileMime ?? "unknown"}`} {...props} />;
}

function ResumeFileView({
  fileUrl,
  fileMime,
  structured,
  structuredStatus,
  height = 720,
}: OriginalResumeProps) {
  const canTryFile = Boolean(fileUrl) && (!fileMime || fileMime === "application/pdf");
  const [file, setFile] = useState<FileState>(canTryFile ? { kind: "loading" } : { kind: "unviewable" });
  const [showDetails, setShowDetails] = useState(false);

  useEffect(() => {
    if (!fileUrl || !canTryFile) return;
    let objectUrl: string | null = null;
    let active = true;
    // Fetched and re-typed as a PDF so the browser draws it instead of
    // downloading it, whatever content type the storage served it with.
    (async () => {
      try {
        const response = await fetch(fileUrl);
        if (!response.ok) throw new Error("unavailable");
        const blob = await response.blob();
        if (!(await startsWithPdfMagic(blob))) throw new Error("not a pdf");
        objectUrl = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
        if (active) setFile({ kind: "pdf", url: objectUrl });
        else URL.revokeObjectURL(objectUrl);
      } catch {
        if (active) setFile((current) => current.kind === "pdf" ? current : { kind: "unviewable" });
      }
    })();
    return () => {
      active = false;
    };
  }, [fileUrl, canTryFile]);

  // Keep the displayed PDF alive until its replacement has actually committed.
  useEffect(() => {
    if (file.kind !== "pdf") return;
    return () => URL.revokeObjectURL(file.url);
  }, [file]);

  const details = structured
    ? <StructuredResumeView resume={structured} />
    : <StructuredResumeUnavailable status={(structuredStatus ?? "UNAVAILABLE") as StructuredStatus} />;

  if (file.kind === "loading") {
    return (
      <p className="inline-flex items-center gap-2 py-6 text-[12px] text-[#5F6B80]" role="status">
        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Loading the resume…
      </p>
    );
  }

  if (file.kind === "unviewable") {
    return (
      <div className="space-y-3">
        {fileUrl && (
          <p className="flex flex-wrap items-center gap-2 rounded-lg border border-[#dfe4ec] bg-[#fafbfc] px-3 py-2 text-[12px] text-[#4b5563]">
            <FileText size={15} aria-hidden="true" />
            The original file cannot be shown here.
            <a href={fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#315c9f] underline">
              Open the original <ExternalLink size={12} aria-hidden="true" />
            </a>
          </p>
        )}
        {details}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <iframe
        title="Resume as provided by the candidate"
        src={file.url}
        className="w-full rounded-lg border border-[#dfe4ec] bg-white"
        style={{ height }}
      />
      <button
        type="button"
        onClick={() => setShowDetails((open) => !open)}
        aria-expanded={showDetails}
        className="text-[12px] font-semibold text-[#315c9f] underline underline-offset-2"
      >
        {showDetails ? "Hide the details we read from it" : "Show the details we read from it"}
      </button>
      {showDetails && details}
    </div>
  );
}
