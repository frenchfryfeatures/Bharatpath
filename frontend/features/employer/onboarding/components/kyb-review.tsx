"use client";

import { AlertTriangle, CheckCircle2, FileText, PencilLine } from "lucide-react";

import type { KybDocument, KybForm } from "@/store/employer/kyb";

import {
  displayAnswer,
  isDocumentSection,
  isFileField,
  isSectionComplete,
  type KybAnswers,
} from "../kyb-form";

interface KybReviewProps {
  form: KybForm;
  answers: KybAnswers;
  documents: Map<string, KybDocument>;
  onEdit: (sectionIndex: number) => void;
}

export function KybReview({
  form,
  answers,
  documents,
  onEdit,
}: Readonly<KybReviewProps>) {
  const uploaded = new Set(documents.keys());

  return (
    <div className="space-y-4">
      {form.sections.map((section, index) => {
        const complete = isSectionComplete(section, answers, uploaded);

        return (
          <section
            key={section.code}
            className="rounded-xl border border-[#e1e6ee]"
            aria-labelledby={`review-${section.code}`}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#eef1f5] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                {complete ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-[#1f8a70]" aria-hidden="true" />
                ) : (
                  <AlertTriangle className="h-4 w-4 shrink-0 text-[#c27803]" aria-hidden="true" />
                )}
                <h2
                  id={`review-${section.code}`}
                  className="truncate text-sm font-semibold text-[#17233a]"
                >
                  {section.title}
                </h2>
                {!complete && (
                  <span className="rounded-full bg-[#fff4e0] px-2 py-0.5 text-[10px] font-semibold text-[#9a5b00]">
                    Needs attention
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => onEdit(index)}
                className="inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-[#3566b8] transition hover:bg-[#f3f7fd]"
              >
                <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
                Edit
              </button>
            </div>

            {isDocumentSection(section) ? (
              <ul className="divide-y divide-[#f1f3f7]">
                {section.fields.map((field) => {
                  const document = documents.get(field.code);

                  return (
                    <li
                      key={field.code}
                      className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-[#4f5666]">
                        <FileText className="h-3.5 w-3.5 shrink-0 text-[#8790a0]" aria-hidden="true" />
                        <span className="truncate">{field.label}</span>
                      </span>
                      <span
                        className={`shrink-0 font-medium ${
                          document
                            ? "text-[#1f7a63]"
                            : field.required
                              ? "text-[#b42318]"
                              : "text-[#8790a0]"
                        }`}
                      >
                        {document
                          ? "Uploaded"
                          : field.required
                            ? "Missing"
                            : "Not provided"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-3 sm:grid-cols-2">
                {section.fields
                  .filter((field) => !isFileField(field))
                  .map((field) => (
                    <div
                      key={field.code}
                      className={
                        field.type === "TEXTAREA" || field.type === "CHECKBOX"
                          ? "sm:col-span-2"
                          : ""
                      }
                    >
                      <dt className="text-[11px] font-semibold text-[#8790a0]">
                        {field.label}
                      </dt>
                      <dd className="mt-0.5 break-words text-[13px] text-[#17233a]">
                        {displayAnswer(form, field, answers[field.code])}
                      </dd>
                    </div>
                  ))}
              </dl>
            )}
          </section>
        );
      })}
    </div>
  );
}
