"use client";

import React, { useRef, useState, DragEvent, ChangeEvent } from "react";
import { Upload, CheckCircle2, FileText, AlertCircle } from "lucide-react";

import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import type { RosterImport } from "@/store/college/roster-imports";

export interface BulkUploadCardProps {
  onUpload: (args: {
    fileName: string;
    csv: string;
  }) => Promise<RosterImport>;
}

export function BulkUploadCard({ onUpload }: BulkUploadCardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadState, setUploadState] = useState<{
    fileName?: string;
    rowCount?: number;
    validRows?: number;
    invalidRows?: number;
    importState?: RosterImport["state"];
    status: "idle" | "uploading" | "success" | "error";
    errorMsg?: string;
  }>({ status: "idle" });

  const handleDownloadTemplate = () => {
    const csvContent =
      "name,phone,email,student_ref\n" +
      "Anjali Kulkarni,91 98765 43210,anjali.k@svit.edu.in,STU001\n" +
      "Rohit Patil,91 98123 45678,rohit.p@svit.edu.in,STU002\n";

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "bharatpath_roster_template.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showSuccessFeedback("Roster template downloaded successfully.");
  };

  const processFile = (file: File) => {
    if (!file.name.endsWith(".csv")) {
      setUploadState({
        status: "error",
        errorMsg: "Please upload a valid .csv file",
      });
      return;
    }

    setUploadState({ status: "uploading", fileName: file.name });

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = (e.target?.result as string) ?? "";

      try {
        const result = await onUpload({
          fileName: file.name,
          csv: text,
        });

        setUploadState({
          status: "success",
          fileName: result.fileName,
          rowCount: result.totalRows,
          validRows: result.validRows,
          invalidRows: result.invalidRows,
          importState: result.state,
        });

        if (result.state === "PREVIEW") {
          requestAnimationFrame(() => {
            document
              .getElementById("roster-imports")
              ?.scrollIntoView({
                behavior: "smooth",
                block: "start",
              });
          });
        }
      } catch {
        setUploadState({
          status: "error",
          fileName: file.name,
          errorMsg: "The roster could not be read. Check the header row.",
        });
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    };
    reader.onerror = () => {
      setUploadState({
        status: "error",
        errorMsg: "Failed to read file",
      });
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      processFile(files[0]);
    }
  };

  return (
    <div
      id="bulk-upload"
      className="scroll-mt-4 rounded-[16px] border border-[#e7e9ee] bg-white p-6 shadow-2xs flex flex-col justify-between"
    >
      <div>
        {/* TITLE & DESCRIPTION */}
        <h3 className="text-[16px] font-bold text-[#151b2b] tracking-[-0.01em]">
          Bulk upload a roster
        </h3>
        <p className="mt-1 text-[13px] text-[#777f90] leading-relaxed">
          CSV with name, phone, email and student_ref. Students still confirm
          consent in their app before any score is shared.
        </p>
        <p className="mt-1 text-[12px] text-[#777f90] leading-relaxed">
          The template uses 91 98765 43210 so spreadsheets keep phones as
          text. Plain 10-digit and +91 formats are also accepted.
        </p>

        {/* DROPZONE */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mt-6 rounded-xl border border-dashed p-8 text-center transition-colors cursor-pointer flex flex-col items-center justify-center ${
            isDragging
              ? "border-[#5b4fcf] bg-[#edf2fa]"
              : uploadState.status === "success"
              ? "border-[#23805d]/40 bg-[#eaf5ef]/40"
              : "border-[#dfe2e8] bg-[#fcfdfe] hover:bg-[#f8f9fb]"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="hidden"
          />

          {uploadState.status === "uploading" ? (
            <div className="py-2 flex flex-col items-center">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#5b4fcf] border-t-transparent mb-2" />
              <p className="text-[13px] font-semibold text-[#151b2b]">
                Parsing {uploadState.fileName}...
              </p>
            </div>
          ) : uploadState.status === "success" ? (
            <div className="flex flex-col items-center">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-[#eaf5ef] text-[#23805d] mb-2">
                <CheckCircle2 size={20} strokeWidth={2.2} />
              </div>
              <p className="text-[14px] font-semibold text-[#151b2b]">
                {uploadState.fileName}
              </p>
              <p className="text-[12px] text-[#23805d] mt-0.5">
                {uploadState.importState === "PREVIEW"
                  ? "Preview ready"
                  : uploadState.importState === "COMMITTED"
                    ? "This roster was already committed"
                    : "This roster was already discarded"}{" "}
                • {uploadState.validRows ?? 0} valid of{" "}
                {uploadState.rowCount ?? 0} rows
              </p>
            </div>
          ) : uploadState.status === "error" ? (
            <div className="flex flex-col items-center">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-[#fdf2f2] text-[#e02424] mb-2">
                <AlertCircle size={20} strokeWidth={2.2} />
              </div>
              <p className="text-[14px] font-semibold text-[#151b2b]">
                Upload failed
              </p>
              <p className="text-[12px] text-[#e02424] mt-0.5">
                {uploadState.errorMsg}
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <Upload
                size={22}
                strokeWidth={2}
                className="text-[#3566b8]"
              />
              <p className="mt-3 text-[14px] font-semibold text-[#151b2b]">
                Drop a CSV here
              </p>
              <p className="mt-0.5 text-[12px] text-[#777f90]">
                Up to 2,000 rows per upload
              </p>
            </div>
          )}
        </div>
      </div>

      {/* FOOTER LINK */}
      <div className="mt-6">
        <button
          type="button"
          onClick={handleDownloadTemplate}
          className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#3566b8] hover:underline cursor-pointer select-none"
        >
          <FileText size={14} className="shrink-0" />
          Download the template
        </button>
      </div>
    </div>
  );
}
