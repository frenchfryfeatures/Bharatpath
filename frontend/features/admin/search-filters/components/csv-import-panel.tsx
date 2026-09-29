"use client";

import { useRef, useState, type DragEvent } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Upload,
} from "lucide-react";

import type { SearchFilterKind } from "@/store/api/admin-api";

import {
  ALIAS_SEPARATOR,
  downloadImportTemplate,
  importTemplateFileName,
  MAX_IMPORT_ROWS,
  type ParsedImport,
} from "../csv";

const PREVIEW_ROWS = 8;
const LISTED_ERRORS = 10;

export function CsvImportPanel({
  kind,
  file,
  isSaving,
  onChooseFile,
  onClearFile,
}: {
  kind: SearchFilterKind;
  file: { name: string; parsed: ParsedImport } | null;
  isSaving: boolean;
  onChooseFile: (file: File) => void;
  onClearFile: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const isCity = kind === "CITY";
  const parsed = file?.parsed ?? null;
  const hasProblems = Boolean(
    parsed && (parsed.fileError || parsed.errors.length > 0),
  );

  const pick = (files: FileList | null) => {
    const chosen = files?.[0];
    if (chosen) {
      onChooseFile(chosen);
    }
    if (inputRef.current) {
      // Choosing the same file again after fixing it must fire `change`.
      inputRef.current.value = "";
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    if (!isSaving) {
      pick(event.dataTransfer.files);
    }
  };

  return (
    <div className="mt-3 space-y-3">
      {/* Template */}
      <div className="flex items-start justify-between gap-3 rounded-lg border border-[#e2e5eb] bg-[#f8f9fb] px-3.5 py-3">
        <div className="min-w-0 text-[12px] leading-[18px] text-[#566176]">
          <p className="font-semibold text-[#172033]">Start from the template</p>
          <p className="mt-0.5">
            Columns:{" "}
            <code className="font-mono text-[11px] text-[#172033]">
              {isCity
                ? "label, state_code, aliases, featured, sort_order"
                : "label, aliases, featured, sort_order"}
            </code>
            . Separate aliases with{" "}
            <code className="font-mono text-[11px] text-[#172033]">
              {ALIAS_SEPARATOR}
            </code>
            . Only <strong>label</strong>
            {isCity ? (
              <>
                {" "}
                and <strong>state_code</strong> are
              </>
            ) : (
              " is"
            )}{" "}
            required; featured defaults to false and sort_order to 0. Up to{" "}
            {MAX_IMPORT_ROWS} rows.
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadImportTemplate(kind)}
          title={importTemplateFileName(kind)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[#d9dee7] bg-white px-3 py-2 text-[12px] font-semibold text-[#315c9f] transition-colors hover:bg-[#eef3fb]"
        >
          <Download className="h-3.5 w-3.5" />
          Download template
        </button>
      </div>

      {/* File */}
      <div
        role="button"
        tabIndex={isSaving ? -1 : 0}
        aria-disabled={isSaving}
        aria-label="Choose a CSV file to import"
        onClick={() => !isSaving && inputRef.current?.click()}
        onKeyDown={(event) => {
          if (!isSaving && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={[
          "flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed px-4 py-6 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315c9f]/25",
          isDragging
            ? "border-[#315c9f] bg-[#eef3fb]"
            : "border-[#d9dee7] bg-white hover:border-[#b9c6dc] hover:bg-[#f8f9fb]",
        ].join(" ")}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(event) => pick(event.target.files)}
        />
        {file ? (
          <>
            <FileSpreadsheet className="h-6 w-6 text-[#315c9f]" />
            <p className="mt-2 text-[13px] font-semibold text-[#172033]">
              {file.name}
            </p>
            <p className="mt-0.5 text-[11px] text-[#7b8494]">
              Click or drop another file to replace it
            </p>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-[#315c9f]" />
            <p className="mt-2 text-[13px] font-semibold text-[#172033]">
              Drop a CSV file here, or click to choose
            </p>
            <p className="mt-0.5 text-[11px] text-[#7b8494]">
              .csv only
            </p>
          </>
        )}
      </div>

      {/* Result */}
      {parsed?.fileError ? (
        <Problem message={parsed.fileError} />
      ) : null}

      {parsed && !parsed.fileError && parsed.errors.length > 0 ? (
        <div className="rounded-lg border border-[#f1c9c9] bg-[#fff6f6] px-3.5 py-3 text-[12px] text-[#9b2c2c]">
          <p className="flex items-center gap-1.5 font-semibold">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {parsed.errors.length} row{parsed.errors.length === 1 ? "" : "s"}{" "}
            need fixing. Nothing is imported until every row is valid.
          </p>
          <ul className="mt-2 space-y-1 pl-5">
            {parsed.errors.slice(0, LISTED_ERRORS).map((problem) => (
              <li key={problem.line} className="list-disc">
                Row {problem.line}: {problem.message}
              </li>
            ))}
          </ul>
          {parsed.errors.length > LISTED_ERRORS ? (
            <p className="mt-1.5 pl-5">
              …and {parsed.errors.length - LISTED_ERRORS} more.
            </p>
          ) : null}
        </div>
      ) : null}

      {parsed && !hasProblems ? (
        <div className="overflow-hidden rounded-lg border border-[#e2e5eb]">
          <p className="flex items-center gap-1.5 border-b border-[#e9ebef] bg-[#eef7f1] px-3.5 py-2 text-[12px] font-semibold text-[#245f3a]">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {parsed.items.length}{" "}
            {isCity ? "cit" : "skill"}
            {isCity
              ? parsed.items.length === 1
                ? "y"
                : "ies"
              : parsed.items.length === 1
                ? ""
                : "s"}{" "}
            ready to import
          </p>
          <div className="max-h-56 overflow-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="sticky top-0 bg-[#fafbfc] text-[10px] font-semibold uppercase tracking-[0.06em] text-[#7b8494]">
                <tr>
                  <th className="px-3 py-2">Label</th>
                  {isCity ? <th className="px-3 py-2">State</th> : null}
                  <th className="px-3 py-2">Aliases</th>
                  <th className="px-3 py-2">Featured</th>
                  <th className="px-3 py-2 text-right">Sort</th>
                </tr>
              </thead>
              <tbody>
                {parsed.items.slice(0, PREVIEW_ROWS).map((item) => (
                  <tr key={item.label} className="border-t border-[#eef0f3]">
                    <td className="px-3 py-2 font-semibold text-[#172033]">
                      {item.label}
                    </td>
                    {isCity ? (
                      <td className="px-3 py-2 text-[#566176]">
                        {item.state_code}
                      </td>
                    ) : null}
                    <td className="px-3 py-2 text-[#566176]">
                      {item.aliases?.length ? item.aliases.join(", ") : "—"}
                    </td>
                    <td className="px-3 py-2 text-[#566176]">
                      {item.featured ? "Yes" : "No"}
                    </td>
                    <td className="px-3 py-2 text-right text-[#566176]">
                      {item.sort_order}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.items.length > PREVIEW_ROWS ? (
            <p className="border-t border-[#eef0f3] px-3.5 py-2 text-[11px] text-[#7b8494]">
              Showing the first {PREVIEW_ROWS} of {parsed.items.length} rows.
            </p>
          ) : null}
        </div>
      ) : null}

      {file ? (
        <button
          type="button"
          onClick={onClearFile}
          disabled={isSaving}
          className="text-[12px] font-semibold text-[#687182] underline-offset-2 hover:text-[#172033] hover:underline disabled:opacity-50"
        >
          Remove file
        </button>
      ) : null}
    </div>
  );
}

function Problem({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-1.5 rounded-lg border border-[#f1c9c9] bg-[#fff6f6] px-3.5 py-3 text-[12px] font-semibold text-[#9b2c2c]">
      <AlertCircle className="mt-px h-4 w-4 shrink-0" />
      {message}
    </p>
  );
}
