"use client";

import { ImageTile } from "@/features/admin/shared/image-tile";

import { useState } from "react";
import {
  AlertCircle,
  Check,
  ExternalLink,
  FileText,
  History,
  Loader2,
  Minus,
  X,
} from "lucide-react";

import { DetailSkeleton } from "@/components/common/loading";
import { ErrorState } from "@/components/ui";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { openFreshDocument } from "@/lib/open-document";
import { choiceLabel, fieldLabel, humanizeCode } from "@/lib/format/labels";
import { INDIAN_STATES } from "@/features/student/onboarding/constants";
import { FieldError } from "../../shared/form";
import { showAdminFeedback } from "@/store/admin";
import { useAppDispatch } from "@/store/hooks";
import {
  type KybReviewFlag,
  useDecideAdminKybMutation,
  useGetAdminIntegritySignalQuery,
  useGetAdminKybSubmissionQuery,
  useResolveAdminIntegritySignalMutation,
} from "@/store/api/admin-api";

import { useQueue } from "../hooks/use-queue";

function formatDetail(value: unknown, code?: string): string {
  if (value === null || value === undefined || value === "") return "Not provided";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map((item) => formatDetail(item, code)).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string") {
    if (code === "state") return INDIAN_STATES.find((state) => state.code === value)?.name ?? choiceLabel(value);
    if (code === "employee_count_band") {
      if (value === "5000_PLUS") return "More than 5,000 employees";
      if (/^\d+_\d+$/.test(value)) return `${value.replace("_", "–")} employees`;
    }
    if (code && ["employer_type", "industry", "employee_count_band", "state", "severity", "status"].includes(code)) return humanizeCode(value);
  }
  return String(value);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Most flags the backend accepts on one decision. */
const MAX_FLAGS = 40;

type KybDecision = "APPROVED" | "REJECTED" | "MORE_INFO_REQUIRED";
type Decision = KybDecision | "CLEARED" | "CONFIRMED";

const DECISION_LABEL: Record<string, { text: string; tone: string }> = {
  APPROVED: { text: "Approved", tone: "bg-[#eef7f1] text-[#2f7b4b]" },
  MORE_INFO_REQUIRED: { text: "Sent back", tone: "bg-[#fff5df] text-[#9a6b18]" },
  REJECTED: { text: "Rejected", tone: "bg-[#fff0f1] text-[#c92f3f]" },
  UNDER_REVIEW: { text: "Under review", tone: "bg-[#eef0ff] text-[#385da8]" },
};

/** Field and document codes the backend named in a 422's `params.fields`. */
function refusedFields(error: unknown): string[] {
  const data = (error as { data?: { params?: { fields?: unknown } } } | undefined)?.data;
  const fields = data?.params?.fields;
  return Array.isArray(fields)
    ? fields.filter((field): field is string => typeof field === "string")
    : [];
}

function ChangedBadge() {
  return (
    <span className="shrink-0 whitespace-nowrap rounded-full bg-[#fff5df] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.04em] text-[#9a6b18]">
      Changed
    </span>
  );
}

/** Ticks a field or document the employer should fix. */
function FlagToggle({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <label
      title="Ask the employer to fix this"
      className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] font-semibold transition-colors ${
        checked ? "bg-[#fff5df] text-[#9a6b18]" : "text-[#7b8494] hover:bg-[#f5f6f8]"
      } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={`Ask the employer to fix ${label}`}
        className="h-3.5 w-3.5 cursor-pointer accent-[#9a6b18]"
      />
      Fix
    </label>
  );
}

function FlagNoteInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="border-t border-[#f3e3bd] bg-[#fffaf0] px-4 py-2.5">
      <input
        type="text"
        value={value}
        maxLength={300}
        onChange={(event) => onChange(event.target.value)}
        placeholder="What should they change? (optional)"
        aria-label={`Note for ${label}`}
        className="w-full rounded-lg border border-[#f2cf93] bg-white px-3 py-2 text-[12px] text-[#172033] outline-none placeholder:text-[#a08a5a] focus:border-[#9a6b18]"
      />
    </div>
  );
}

export function QueueDrawer() {
  const { openReviewId } = useQueue();

  // Keyed by the open item so the remark and ticked fields never carry over.
  return openReviewId ? <QueueDrawerBody key={openReviewId} /> : null;
}

function QueueDrawerBody() {
  const dispatch = useAppDispatch();
  const { openReviewId, items, closeReview } = useQueue();
  useScrollLock(Boolean(openReviewId));
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | undefined>();
  // Fields and documents the reviewer wants corrected, each with an optional note.
  const [flags, setFlags] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Decision | null>(null);
  const [confirmation, setConfirmation] = useState<KybDecision | null>(null);
  const [documentOpening, setDocumentOpening] = useState<string | null>(null);
  const [documentError, setDocumentError] = useState(false);

  /*
   * ================================================================
   * FIND CURRENT ITEM
   * ================================================================
   */

  const item = items.find(
    (queueItem) =>
      queueItem.id === openReviewId,
  );

  const isKyb = item?.type === "KYB";
  const kybDetail = useGetAdminKybSubmissionQuery(openReviewId ?? "", {
    skip: !openReviewId || !isKyb,
  });
  const integrityDetail = useGetAdminIntegritySignalQuery(openReviewId ?? "", {
    skip: !openReviewId || isKyb,
  });
  const [decideKyb, kybDecision] = useDecideAdminKybMutation();
  const [resolveSignal, signalDecision] = useResolveAdminIntegritySignalMutation();

  if (!item) {
    return null;
  }

  const detailLoading = kybDetail.isLoading || integrityDetail.isLoading;
  const actionLoading = kybDecision.isLoading || signalDecision.isLoading;
  const actionError = kybDecision.error || signalDecision.error;
  const refused = refusedFields(actionError);

  /*
   * ================================================================
   * VERIFICATION CHECKS
   * ================================================================
   */

  const changed = kybDetail.data?.changed_since_last_review ?? null;
  const changedFields = new Set(changed?.fields ?? []);
  const changedDocuments = new Set(changed?.documents ?? []);
  const changedCount = changedFields.size + changedDocuments.size;

  const verificationChecks = isKyb
    ? Object.entries(kybDetail.data?.answers ?? {}).map(([code, value]) => ({
        code,
        label: fieldLabel(code),
        detail: formatDetail(value, code),
        status: value === null || value === "" ? ("Not run" as const) : ("Passed" as const),
        changed: changedFields.has(code),
      }))
    : Object.entries(integrityDetail.data?.evidence ?? {}).map(([code, value]) => ({
        code,
        label: fieldLabel(code),
        detail: formatDetail(value, code),
        status: "Attention" as const,
        changed: false,
      }));

  /*
   * ================================================================
   * DOCUMENTS
   * ================================================================
   */

  const documents = (kybDetail.data?.documents ?? []).map((document) => ({
    code: document.doc_type,
    name: fieldLabel(document.doc_type),
    changed: changedDocuments.has(document.doc_type),
    meta: `${document.mime ?? "Document"} · ${new Date(document.uploaded_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}`,
  }));

  /*
   * ================================================================
   * FLAGS AND DECISION
   * ================================================================
   */

  const reviews = kybDetail.data?.reviews ?? [];
  const flagCodes = Object.keys(flags);

  const toggleFlag = (code: string) => {
    setFlags((current) => {
      if (code in current) {
        const next = { ...current };
        delete next[code];
        return next;
      }
      return { ...current, [code]: "" };
    });
    setNoteError(undefined);
  };

  const viewDocument = async (code: string) => {
    setDocumentOpening(code);
    setDocumentError(false);
    // The link lives 15 minutes, so each click asks for a fresh one.
    const opened = await openFreshDocument(async () => {
      const latest = await kybDetail.refetch().unwrap();
      return latest.documents.find((document) => document.doc_type === code)?.url;
    });
    setDocumentError(!opened);
    setDocumentOpening(null);
  };

  const validateDecision = (decision: Decision): boolean => {
    // KYB reasons are read back by the organisation; the backend caps them at 1000
    // characters (integrity notes at 2000).
    const needsReason = isKyb && (decision === "REJECTED" || decision === "MORE_INFO_REQUIRED");
    const limit = isKyb ? 1000 : 2000;
    if (needsReason && !note.trim()) {
      setNoteError(
        decision === "REJECTED"
          ? "Cannot reject this submission without a remark. Enter the rejection reason in ‘Remark to the employer’, then click Reject again."
          : "Cannot send back this submission without a remark. Explain what the employer needs to fix, then click Send back again.",
      );
      return false;
    }
    if (isKyb && decision === "APPROVED" && flagCodes.length > 0) {
      setNoteError("Untick the flagged items to approve, or use Send back to ask for changes.");
      return false;
    }
    if (note.trim().length > limit) {
      setNoteError(`Use ${limit} characters or fewer. This is ${note.trim().length}.`);
      return false;
    }
    if (flagCodes.length > MAX_FLAGS) {
      setNoteError(`Flag at most ${MAX_FLAGS} items. ${flagCodes.length} are ticked.`);
      return false;
    }
    setNoteError(undefined);
    return true;
  };

  const requestDecision = (decision: KybDecision) => {
    if (actionLoading || detailLoading || !validateDecision(decision)) return;
    setConfirmation(decision);
  };

  const submitDecision = async (decision: Decision) => {
    if (actionLoading || pending || !validateDecision(decision)) return;
    setPending(decision);
    try {
      if (isKyb) {
        const sendsFlags = decision === "REJECTED" || decision === "MORE_INFO_REQUIRED";
        const payload: KybReviewFlag[] = flagCodes.map((field) => ({
          field,
          ...(flags[field].trim() ? { note: flags[field].trim() } : {}),
        }));
        await decideKyb({
          submissionId: item.id,
          decision: decision as KybDecision,
          reason: note.trim() || undefined,
          ...(sendsFlags && payload.length > 0 ? { flags: payload } : {}),
        }).unwrap();
      } else {
        await resolveSignal({ signalId: item.id, outcome: decision as "CLEARED" | "CONFIRMED", note: note.trim() || undefined }).unwrap();
      }
    } catch {
      // Surfaced to the operator through `actionError` below.
      setPending(null);
      setConfirmation(null);
      return;
    }
    setPending(null);
    dispatch(
      showAdminFeedback(
        {
          APPROVED: "KYB submission approved.",
          REJECTED: "KYB submission rejected. The organisation can start a new one.",
          MORE_INFO_REQUIRED: "Sent back to the employer for changes.",
          CLEARED: "Integrity signal cleared.",
          CONFIRMED: "Integrity signal confirmed.",
        }[decision],
      ),
    );
    setNote("");
    closeReview();
  };

  /*
   * ================================================================
   * RISK STYLES
   * ================================================================
   */

  const riskStyles = {
    High: {
      background: "bg-[#fff0f1]",
      text: "text-[#c92f3f]",
    },

    Medium: {
      background: "bg-[#fff5df]",
      text: "text-[#9a6b18]",
    },

    Low: {
      background: "bg-[#eef7f1]",
      text: "text-[#2f7b4b]",
    },
  };

  const riskStyle =
    riskStyles[
      (item.risk ?? "Medium") as keyof typeof riskStyles
    ] ?? riskStyles.Medium;

  /*
   * ================================================================
   * STATUS STYLES
   * ================================================================
   */

  const getStatusStyle = (
    status: "Passed" | "Attention" | "Not run",
  ) => {
    if (status === "Passed") {
      return {
        icon:
          "bg-[#eef7f1] text-[#2f7b4b]",
        badge:
          "bg-[#eef7f1] text-[#2f7b4b]",
      };
    }

    if (status === "Attention") {
      return {
        icon:
          "bg-[#fff5df] text-[#9a6b18]",
        badge:
          "bg-[#fff5df] text-[#9a6b18]",
      };
    }

    return {
      icon:
        "bg-[#f0f2f5] text-[#687182]",
      badge:
        "bg-[#f0f2f5] text-[#687182]",
    };
  };

  const footerButton =
    "cursor-pointer rounded-lg px-3 py-3 text-[13px] font-semibold leading-[17px] transition-colors disabled:cursor-not-allowed disabled:opacity-60";

  /*
   * ================================================================
   * DRAWER
   * ================================================================
   */

  return (
    <div data-scroll-lock-root className="fixed inset-0 z-[100]">
      {/* ============================================================
          BACKDROP
          ============================================================ */}

      <button
        type="button"
        aria-label="Close drawer"
        onClick={closeReview}
        className="absolute inset-0 cursor-default bg-[#172033]/30"
      />

      {/* ============================================================
          DRAWER PANEL
          ============================================================ */}

      <aside className="absolute right-0 top-0 flex h-full w-[520px] max-w-full flex-col bg-white shadow-[-20px_0_60px_-24px_rgba(0,0,0,0.5)]">
        {/* ==========================================================
            HEADER
            ========================================================== */}

        <div className="flex shrink-0 items-start gap-3 border-b border-[#e5e7eb] px-4 py-3">
          {/* Avatar */}

          <ImageTile src={item.imageUrl} initials={item.initials} fit={item.imageFit} className={[
              "grid h-10 w-10 shrink-0 place-items-center rounded-xl",
              isKyb
                ? "bg-[#eef0ff] text-[#385da8]"
                : "bg-[#fff5df] text-[#9a6b18]",
              "text-[13px] font-bold leading-[17px]",
            ].join(" ")}
           />

          {/* Name + submitted */}

          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="truncate text-[18px] font-bold leading-[23px] tracking-[-0.012em] text-[#172033]">
              {item.name}
            </p>

            <p className="truncate text-[12px] leading-[17px] text-[#7b8494]">
              {item.submitted}
            </p>
          </div>

          {/* Close */}

          <button
            type="button"
            onClick={closeReview}
            aria-label="Close"
            title="Close"
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-[#7b8494] transition-colors hover:bg-[#f5f6f8] hover:text-[#172033]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ==========================================================
            SCROLLABLE BODY
            ========================================================== */}

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {detailLoading ? <DetailSkeleton sections={2} /> : null}
          {!detailLoading && (kybDetail.error || integrityDetail.error) ? (
            <ErrorState error={kybDetail.error || integrityDetail.error} fallback="Could not load review details." />
          ) : null}
          <div className="flex flex-col gap-5">
            {/* ======================================================
                RISK + TYPE
                ====================================================== */}

            <div className="flex flex-wrap gap-2">
              {/* Risk */}

              {item.risk ? (
              <span
                className={[
                  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1",
                  "text-[11px] font-semibold leading-[14px]",
                  riskStyle.background,
                  riskStyle.text,
                ].join(" ")}
              >
                Risk · {item.risk}
              </span>
              ) : null}

              {/* Queue type */}

              <span
                className={[
                  "inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2.5 py-1",
                  "text-[11px] font-semibold leading-[14px]",
                  isKyb
                    ? "bg-[#eef0ff] text-[#385da8]"
                    : "bg-[#fff5df] text-[#9a6b18]",
                ].join(" ")}
              >
                {isKyb
                  ? "KYB submission"
                  : "Integrity flag"}
              </span>

              {item.resubmitted ? (
                <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-[#fff5df] px-2.5 py-1 text-[11px] font-semibold leading-[14px] text-[#9a6b18]">
                  Resubmitted
                </span>
              ) : null}

              {item.afterRejection ? (
                <span className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-[#eef0ff] px-2.5 py-1 text-[11px] font-semibold leading-[14px] text-[#385da8]">
                  Re-applied after rejection
                </span>
              ) : null}
            </div>

            {/* ======================================================
                WHAT CHANGED SINCE THE LAST DECISION
                ====================================================== */}

            {isKyb && changedCount > 0 ? (
              <div
                role="note"
                className="flex gap-3 rounded-xl border border-[#f2cf93] bg-[#fffaf0] p-3.5"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#9a6b18]" aria-hidden="true" />
                <p className="text-[12px] leading-[18px] text-[#7a4a00]">
                  <span className="font-semibold">Re-check what changed since your last review: </span>
                  {[
                    changedFields.size > 0
                      ? `${changedFields.size} ${changedFields.size === 1 ? "field" : "fields"}`
                      : null,
                    changedDocuments.size > 0
                      ? `${changedDocuments.size} ${changedDocuments.size === 1 ? "document" : "documents"}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" and ")}
                  . They are marked Changed below.
                </p>
              </div>
            ) : null}

            {/* ======================================================
                VERIFICATION CHECKS
                ====================================================== */}

            <section className="flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[11px] font-bold uppercase leading-[14px] tracking-[0.06em] text-[#7b8494]">
                  Verification checks
                </h3>
                {isKyb ? (
                  <span className="text-[11px] leading-[14px] text-[#7b8494]">
                    Tick Fix to ask for a correction
                  </span>
                ) : null}
              </div>

              <div className="flex flex-col overflow-hidden rounded-xl border border-[#e5e7eb]">
                {verificationChecks.length === 0 ? (
                  <p className="px-4 py-3 text-[12px] text-[#7b8494]">No review evidence was supplied.</p>
                ) : null}
                {verificationChecks.map(
                  (check, index) => {
                    const styles =
                      getStatusStyle(
                        check.status,
                      );
                    const flagged = isKyb && check.code in flags;

                    return (
                      <div
                        key={check.code}
                        className={[
                          index > 0
                            ? "border-t border-[#eef0f3]"
                            : "",
                          flagged ? "bg-[#fffaf0]" : check.changed ? "bg-[#fffdf6]" : "",
                        ].join(" ")}
                      >
                        <div className="flex items-center gap-3 px-4 py-3">
                          {/* Status icon */}

                          <span
                            className={[
                              "grid h-8 w-8 shrink-0 place-items-center rounded-lg",
                              styles.icon,
                            ].join(" ")}
                          >
                            {check.status ===
                              "Passed" && (
                              <Check className="h-4 w-4" />
                            )}

                            {check.status ===
                              "Attention" && (
                              <AlertCircle className="h-4 w-4" />
                            )}

                            {check.status ===
                              "Not run" && (
                              <Minus className="h-4 w-4" />
                            )}
                          </span>

                          {/* Check information */}

                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <p className="flex items-center gap-2 text-[13px] font-semibold leading-[17px] text-[#172033]">
                              <span className="truncate">{check.label}</span>
                              {check.changed ? <ChangedBadge /> : null}
                            </p>

                            <p className="truncate text-[11px] leading-[14px] text-[#7b8494]">
                              {check.detail}
                            </p>
                          </div>

                          {/* Status */}

                          {isKyb ? (
                            <FlagToggle
                              label={check.label}
                              checked={flagged}
                              disabled={actionLoading}
                              onChange={() => toggleFlag(check.code)}
                            />
                          ) : (
                            <span
                              className={[
                                "shrink-0 whitespace-nowrap rounded-full px-2.5 py-1",
                                "text-[11px] font-semibold leading-[14px]",
                                styles.badge,
                              ].join(" ")}
                            >
                              {check.status}
                            </span>
                          )}
                        </div>

                        {flagged ? (
                          <FlagNoteInput
                            label={check.label}
                            value={flags[check.code]}
                            onChange={(value) =>
                              setFlags((current) => ({ ...current, [check.code]: value }))
                            }
                          />
                        ) : null}
                      </div>
                    );
                  },
                )}
              </div>
            </section>

            {/* ======================================================
                DOCUMENTS
                ====================================================== */}

            {isKyb ? <section className="flex flex-col gap-3">
              <h3 className="text-[11px] font-bold uppercase leading-[14px] tracking-[0.06em] text-[#7b8494]">
                Documents
              </h3>

              <div className="flex flex-col gap-2">
                {documents.length === 0 ? <p className="text-[12px] text-[#7b8494]">No documents attached.</p> : null}
                {documents.map(
                  (document) => {
                    const flagged = document.code in flags;

                    return (
                      <div
                        key={document.code}
                        className={`overflow-hidden rounded-[10px] border ${
                          flagged ? "border-[#f2cf93]" : "border-[#e5e7eb]"
                        }`}
                      >
                        <div
                          className={`flex items-center gap-3 px-4 py-3 ${
                            flagged ? "bg-[#fffaf0]" : document.changed ? "bg-[#fffdf6]" : ""
                          }`}
                        >
                          {/* File icon */}

                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f0f2f5]">
                            <FileText className="h-4 w-4 text-[#172033]" />
                          </span>

                          {/* Document information */}

                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <p className="flex items-center gap-2 text-[13px] font-semibold leading-[17px] text-[#172033]">
                              <span className="truncate">{document.name}</span>
                              {document.changed ? <ChangedBadge /> : null}
                            </p>

                            <p className="truncate text-[11px] leading-[14px] text-[#7b8494]">
                              {document.meta}
                            </p>
                          </div>

                          {/* Open document */}

                          <button
                            type="button"
                            onClick={() => void viewDocument(document.code)}
                            disabled={documentOpening === document.code}
                            aria-label={`View ${document.name}`}
                            title="Open the uploaded file in a new tab"
                            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-[#385da8] transition-colors hover:bg-[#eef0ff] disabled:cursor-wait disabled:opacity-60"
                          >
                            {documentOpening === document.code ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                            ) : (
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>

                          <FlagToggle
                            label={document.name}
                            checked={flagged}
                            disabled={actionLoading}
                            onChange={() => toggleFlag(document.code)}
                          />
                        </div>

                        {flagged ? (
                          <FlagNoteInput
                            label={document.name}
                            value={flags[document.code]}
                            onChange={(value) =>
                              setFlags((current) => ({ ...current, [document.code]: value }))
                            }
                          />
                        ) : null}
                      </div>
                    );
                  },
                )}
                {documentError ? (
                  <p role="alert" className="text-[12px] font-medium text-[#c92f3f]">
                    Could not open that file. Try again.
                  </p>
                ) : null}
              </div>
            </section> : null}

            {/* ======================================================
                HISTORY (earlier decisions, oldest first)
                ====================================================== */}

            {isKyb && reviews.length > 0 ? (
              <section className="flex flex-col gap-3" aria-label="History">
                <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase leading-[14px] tracking-[0.06em] text-[#7b8494]">
                  <History className="h-3.5 w-3.5" aria-hidden="true" />
                  History
                </h3>

                <ol className="flex flex-col gap-2">
                  {reviews.map((review) => {
                    const label = DECISION_LABEL[review.decision] ?? {
                      text: review.decision,
                      tone: "bg-[#f0f2f5] text-[#687182]",
                    };

                    return (
                      <li
                        key={`${review.reviewed_at}-${review.decision}`}
                        className="rounded-[10px] border border-[#e5e7eb] px-4 py-3"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold leading-[14px] ${label.tone}`}
                          >
                            {label.text}
                          </span>
                          <time
                            dateTime={review.reviewed_at}
                            className="text-[11px] leading-[14px] text-[#7b8494]"
                          >
                            {formatDateTime(review.reviewed_at)}
                          </time>
                        </div>

                        {review.reason ? (
                          <p className="mt-2 text-[13px] leading-[18px] text-[#172033]">
                            {review.reason}
                          </p>
                        ) : null}

                        {review.flags.length > 0 ? (
                          <ul className="mt-2 flex flex-col gap-1">
                            {review.flags.map((flag) => (
                              <li
                                key={flag.field}
                                className="text-[11px] leading-[16px] text-[#687182]"
                              >
                                <span className="font-semibold capitalize text-[#344054]">
                                  {fieldLabel(flag.field)}
                                </span>
                                {flag.note ? ` · ${flag.note}` : ""}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </section>
            ) : null}

            {/* ======================================================
                DECISION NOTE
                ====================================================== */}

            <label className="flex flex-col gap-2">
              <span className="text-[13px] font-semibold leading-[17px] text-[#172033]">
                {isKyb ? "Remark to the employer" : "Decision note"}
              </span>

              <textarea
                rows={3}
                value={note}
                onChange={(event) => { setNote(event.target.value); setNoteError(undefined); }}
                placeholder={
                  isKyb
                    ? "Required for Send back and Reject. The employer reads this."
                    : "Recorded in the audit trail against your operator ID"
                }
                aria-label={isKyb ? "Remark to the employer" : "Decision note"}
                aria-invalid={noteError ? true : undefined}
                aria-describedby={noteError ? "decision-note-error" : undefined}
                className={`w-full resize-y rounded-[10px] border px-4 py-3 text-[13px] font-medium leading-[18px] text-[#172033] outline-none transition-colors placeholder:text-[#7b8494] ${noteError ? "border-[#d92d20] focus:border-[#d92d20]" : "border-[#e5e7eb] focus:border-[#315c9f]"}`}
              />
              {isKyb && flagCodes.length > 0 ? (
                <span className="text-[11px] leading-[15px] text-[#9a6b18]">
                  {flagCodes.length} {flagCodes.length === 1 ? "item" : "items"} will be marked for the employer to fix
                  (Send back or Reject only).
                </span>
              ) : null}
              {actionError ? (
                <>
                  <ErrorState error={actionError} fallback="The decision could not be saved. Try again." />
                  {refused.length > 0 ? (
                    <p className="text-[11px] leading-[15px] text-[#c92f3f]">
                      Refused: {refused.map(fieldLabel).join(", ")}
                    </p>
                  ) : null}
                </>
              ) : null}
            </label>
          </div>
        </div>

        {/* ==========================================================
            FOOTER
            ========================================================== */}

        {noteError ? (
          <div className="shrink-0 border-t border-[#fecaca] bg-[#fff0f1] px-4 py-3">
            <FieldError id="decision-note-error" message={noteError} />
          </div>
        ) : null}
        <div className="flex shrink-0 gap-2 border-t border-[#e5e7eb] px-2 py-3">
          {/* Reject / Confirm */}

          <button
            type="button"
            disabled={actionLoading || detailLoading}
            onClick={() => isKyb ? requestDecision("REJECTED") : void submitDecision("CONFIRMED")}
            title={isKyb ? "Final. The employer starts a new submission, pre-filled." : undefined}
            className={`${footerButton} flex-1 border border-[#c92f3f] bg-white text-[#c92f3f] hover:bg-[#fff7f7]`}
          >
            {pending === "REJECTED" || pending === "CONFIRMED" ? "Saving..." : isKyb ? "Reject" : "Confirm"}
          </button>

          {/* Send back (KYB only) */}

          {isKyb ? (
            <button
              type="button"
              disabled={actionLoading || detailLoading}
              onClick={() => requestDecision("MORE_INFO_REQUIRED")}
              title="The employer fixes this same submission and resubmits."
              className={`${footerButton} flex-1 border border-[#9a6b18] bg-white text-[#9a6b18] hover:bg-[#fffaf0]`}
            >
              {pending === "MORE_INFO_REQUIRED" ? "Saving..." : "Send back"}
            </button>
          ) : null}

          {/* Approve / Clear */}

          <button
            type="button"
            disabled={actionLoading || detailLoading}
            onClick={() => isKyb ? requestDecision("APPROVED") : void submitDecision("CLEARED")}
            className={`${footerButton} flex-[1.4] bg-[#5b4fcf] text-white hover:bg-[#4f44bc]`}
          >
            {pending === "APPROVED" || pending === "CLEARED" ? "Saving..." : isKyb ? "Approve" : "Clear"}
          </button>
        </div>
      </aside>
      <ConfirmModal
        open={confirmation !== null}
        title={confirmation === "REJECTED" ? "Reject this submission?" : confirmation === "MORE_INFO_REQUIRED" ? "Send back for changes?" : "Approve this submission?"}
        description={confirmation === "REJECTED"
          ? `${item.name}'s submission will be rejected. The employer can start a new submission.`
          : confirmation === "MORE_INFO_REQUIRED"
            ? `${item.name} will be asked to correct this submission and resubmit it for review.`
            : `${item.name}'s business verification will be approved.`}
        confirmLabel={confirmation === "REJECTED" ? "Reject submission" : confirmation === "MORE_INFO_REQUIRED" ? "Send back" : "Approve submission"}
        tone={confirmation === "REJECTED" ? "danger" : "default"}
        icon={confirmation === "APPROVED" ? <Check size={18} /> : <AlertCircle size={18} />}
        confirmLoading={actionLoading || pending !== null}
        onClose={() => { if (!actionLoading && !pending) setConfirmation(null); }}
        onConfirm={() => { if (confirmation) void submitDecision(confirmation); }}
      >
        <div className="max-h-[45vh] overflow-y-auto">
        {note.trim() ? (
          <div className="rounded-lg bg-[#f7f8fa] p-3">
            <p className="text-[12px] font-semibold text-[#172033]">Remark to the employer</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[13px] text-[#5d6673]">{note.trim()}</p>
          </div>
        ) : null}
        {confirmation !== "APPROVED" && flagCodes.length > 0 ? (
          <div className="mt-3 text-[12px] text-[#5d6673]">
            <p className="font-semibold text-[#172033]">Items to fix ({flagCodes.length})</p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {flagCodes.map((code) => (
                <li key={code} className="break-words">{fieldLabel(code)}{flags[code].trim() ? `: ${flags[code].trim()}` : ""}</li>
              ))}
            </ul>
          </div>
        ) : null}
        </div>
      </ConfirmModal>
    </div>
  );
}
