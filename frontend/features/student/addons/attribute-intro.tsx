"use client";

import { choiceLabel } from "@/lib/format/labels";

import { useMemo, useState } from "react";
import { Check, Info, Pencil, Search, X } from "lucide-react";
import { Skeleton } from "@/components/common/loading";

import {
  useGetQuestionnaireQuery,
  useSaveQuestionnaireAnswersMutation,
  useSubmitQuestionnaireMutation,
} from "@/store/student";
import type {
  QuestionnaireQuestion,
  QuestionnaireView,
} from "@/features/student/types";
import {
  PillButton,
  StudentCard,
  StudentErrorState,
} from "@/features/student/components";
import { StudentPage, StudentTopBar } from "@/features/student/shell";

export function AttributeIntro() {
  const questionnaire = useGetQuestionnaireQuery();

  return (
    <StudentPage>
      <div className="flex flex-col gap-5">
        {questionnaire.isLoading ? (
          <>
            <StudentTopBar title="Attribute check" />
            <div role="status" aria-label="Loading attribute check" className="flex flex-col gap-4">
              {[0, 1].map((section) => (
                <StudentCard key={section} className="flex flex-col gap-6">
                  {[0, 1, 2].map((question) => (
                    <div key={question} className="flex flex-col gap-3">
                      <Skeleton width="65%" height={16} />
                      <Skeleton width="35%" height={14} />
                    </div>
                  ))}
                </StudentCard>
              ))}
            </div>
          </>
        ) : questionnaire.error ? (
          <>
            <StudentTopBar title="Attribute check" />
            <StudentErrorState
              title="Questionnaire unavailable"
              error={questionnaire.error}
              fallback="Could not load the questionnaire."
            />
          </>
        ) : questionnaire.data ? (
          <QuestionnaireForm
            questionnaire={questionnaire.data}
          />
        ) : null}
      </div>
    </StudentPage>
  );
}

function QuestionnaireForm({
  questionnaire,
}: {
  questionnaire: QuestionnaireView;
}) {
  const [saveAnswers, saveState] = useSaveQuestionnaireAnswersMutation();
  const [submit, submitState] = useSubmitQuestionnaireMutation();
  const [answers, setAnswers] = useState<Record<string, unknown>>(
    questionnaire.answers,
  );
  const [isEditing, setIsEditing] = useState(!questionnaire.submitted);


  const questions = useMemo(
    () => questionnaire.sections.flatMap((section) => section.questions),
    [questionnaire.sections],
  );
  const sectionRanges = useMemo(() => {
    let next = 1;
    return questionnaire.sections.map((section) => {
      const start = next;
      next += section.questions.length;
      return { section, start, end: next - 1 };
    });
  }, [questionnaire.sections]);
  const missingRequired = questions.some((question) => {
    const answer = answers[question.code];
    return (
      question.required &&
      (answer === undefined ||
        answer === null ||
        answer === "" ||
        (Array.isArray(answer) && answer.length === 0))
    );
  });
  const actionError = saveState.error ?? submitState.error;
  const cleanedAnswers = Object.fromEntries(
    Object.entries(answers).map(([code, answer]) => [
      code,
      answer === "" || (Array.isArray(answer) && answer.length === 0)
        ? null
        : answer,
    ]),
  );

  const save = async () => {
    try {
      await saveAnswers({ answers: cleanedAnswers }).unwrap();
      if (questionnaire.submitted) setIsEditing(false);
    } catch {
      // Mutation state renders the error.
    }
  };

  const finish = async () => {
    try {
      await saveAnswers({
        answers: cleanedAnswers,
        __suppressSuccessFeedback: true,
      }).unwrap();
      await submit().unwrap();
    } catch {
      // Mutation state renders the error.
    }
  };

  return (
    <>
        <StudentTopBar
          title="Attribute check"
          right={questionnaire.submitted && !isEditing ? (
            <PillButton
              variant="secondary"
              className="shrink-0 !rounded-xl !border !border-[#DED6EB] !bg-white !px-4 !py-2.5 !text-[14px] !text-[#4A3E8F] shadow-sm hover:!bg-[#F7F4FC]"
              icon={<Pencil size={16} aria-hidden="true" />}
              onClick={() => {
                setAnswers(questionnaire.answers);
                setIsEditing(true);
              }}
            >
              Edit answers
            </PillButton>
          ) : undefined}
        />
        {questionnaire.submitted && !isEditing ? (
          <div className="flex max-w-3xl flex-col gap-8">
            {sectionRanges.map(({ section, start, end }) => (
              <section key={section.code} className="flex flex-col gap-4">
                <SectionHeader code={section.code} start={start} end={end} total={questions.length} />
                {section.questions.map((question) => {
                  const answer = formatAnswer(question, questionnaire.answers[question.code]);
                  const answered = answer !== "Not answered";
                  return (
                    <div key={question.key} className="flex flex-col gap-3 rounded-2xl border border-[#E7E0D4] bg-white p-5">
                      <p className="text-[15px] font-semibold leading-snug text-[#0A1931]">
                        {question.prompt}
                      </p>
                      {answered ? (
                        <div className="flex flex-wrap gap-2">
                          {answer.split(", ").map((part) => (
                            <span key={part} className="inline-flex items-center gap-2 rounded-full border border-[#C9BEEB] bg-[#F1EAF7] px-3 py-1.5 text-[14px] text-[#4A3E8F]">
                              <Check size={13} strokeWidth={3} aria-hidden="true" />
                              {part}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[14px] text-[#8891A0]">Not answered</p>
                      )}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-8 max-w-3xl">
              {sectionRanges.map(({ section, start, end }) => (
                <section key={section.code} className="flex flex-col gap-4">
                  <SectionHeader code={section.code} start={start} end={end} total={questions.length} />
                  {section.questions.map((question, index) => (
                    <QuestionField
                      key={question.key}
                      number={start + index}
                      question={question}
                      value={answers[question.code]}
                      onChange={(value) =>
                        setAnswers((current) => ({
                          ...current,
                          [question.code]: value,
                        }))
                      }
                    />
                  ))}
                </section>
              ))}
            </div>

            <div className="flex max-w-3xl items-center gap-3 rounded-xl bg-[#F7EFD9] px-4 py-3 text-[14px] text-[#3A4761]">
              <Info size={18} aria-hidden="true" className="shrink-0" />
              These answers never change your resume score.
            </div>

            {actionError ? (
              <StudentErrorState
                variant="inline"
                error={actionError}
                fallback="Could not save your answers."
              />
            ) : null}
            <div className="sticky bottom-0 z-10 -mx-1 flex max-w-3xl gap-3 border-t border-[#E7E0D4] bg-[#FFFCF7] px-1 py-3">
              {questionnaire.submitted ? (
                <>
                  <PillButton variant="secondary" className="flex-1" disabled={saveState.isLoading} onClick={() => {
                    setAnswers(questionnaire.answers);
                    setIsEditing(false);
                  }}>
                    Cancel
                  </PillButton>
                  <PillButton className="flex-1" disabled={missingRequired || saveState.isLoading} onClick={() => void save()}>
                    Save changes
                  </PillButton>
                </>
              ) : (
                <>
                  <PillButton variant="secondary" className="flex-1" disabled={saveState.isLoading || submitState.isLoading} onClick={() => void save()}>
                    Save and exit
                  </PillButton>
                  <PillButton className="flex-1" disabled={missingRequired || saveState.isLoading || submitState.isLoading} onClick={() => void finish()}>
                    Submit
                  </PillButton>
                </>
              )}
            </div>
          </>
        )}
    </>
  );
}

function formatAnswer(question: QuestionnaireQuestion, value: unknown): string {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return "Not answered";
  if (question.type === "BOOLEAN") return value ? "Yes" : "No";
  if (question.type === "SINGLE" || question.type === "MULTI") {
    const codes = Array.isArray(value) ? value : [value];
    return codes.map((code) => question.options.find((option) => option.code === code)?.label ?? choiceLabel(String(code))).join(", ");
  }
  return String(value);
}

function QuestionField({
  number,
  question,
  value,
  onChange,
}: {
  number: number;
  question: QuestionnaireQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const answered =
    value !== undefined &&
    value !== null &&
    value !== "" &&
    !(Array.isArray(value) && value.length === 0);
  return (
    <fieldset
      aria-label={`Question ${number}`}
      className="flex flex-col gap-3 rounded-2xl border border-[#E7E0D4] bg-white p-5"
    >
      <legend className="float-left w-full text-[15px] font-semibold leading-snug text-[#0A1931]">
        {question.prompt}
        {question.required ? " *" : ""}
      </legend>
      {question.helpText ? (
        <p className="text-[14px] text-[#5F6B80]">{question.helpText}</p>
      ) : null}
      {question.type === "SINGLE" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {question.options.map((option) => (
            <Choice
              key={option.code}
              selected={value === option.code}
              onClick={() => onChange(option.code)}
            >
              {option.label}
            </Choice>
          ))}
        </div>
      ) : null}
      {question.type === "MULTI" ? (
        question.code === "PREFERRED_LOCATIONS" ? (
          <PlacePicker value={value} onChange={onChange} />
        ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {question.options.map((option) => {
            const selected = Array.isArray(value) && value.includes(option.code);
            return (
              <Choice
                key={option.code}
                selected={selected}
                onClick={() => {
                  const current = Array.isArray(value) ? value : [];
                  onChange(
                    selected
                      ? current.filter((item) => item !== option.code)
                      : [...current, option.code],
                  );
                }}
              >
                {option.label}
              </Choice>
            );
          })}
        </div>
        )
      ) : null}
      {question.type === "BOOLEAN" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <Choice selected={value === true} onClick={() => onChange(true)}>
            Yes
          </Choice>
          <Choice selected={value === false} onClick={() => onChange(false)}>
            No
          </Choice>
        </div>
      ) : null}
      {question.type === "NUMBER" ? (
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          placeholder="Enter a number"
          onChange={(event) =>
            onChange(event.target.value === "" ? "" : Number(event.target.value))
          }
          className="rounded-xl border border-[#E7E0D4] bg-[#FFFCF7] px-3.5 py-2.5 text-[14px] outline-none placeholder:text-[#8891A0] focus:border-[#5F4DB2]"
        />
      ) : null}
      {question.type === "TEXT" ? (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className="rounded-xl border border-[#E7E0D4] bg-[#FFFCF7] px-3.5 py-2.5 text-[14px] outline-none focus:border-[#5F4DB2]"
        />
      ) : null}
      {answered && question.code !== "PREFERRED_LOCATIONS" ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          className="self-start text-[14px] font-medium text-[#5F4DB2] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30"
        >
          Clear answer
        </button>
      ) : null}
    </fieldset>
  );
}

function SectionHeader({ code, start, end, total }: { code: string; start: number; end: number; total: number }) {
  return (
    <header className="flex flex-col gap-2">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-[#A67C12]">
        {sectionTitle(code)}
      </p>
      <h2 className="text-[22px] font-bold leading-tight text-[#0A1931]">
        {sectionTitle(code)}
      </h2>
      <p className="text-[14px] text-[#5F6B80]">
        {start === end
          ? `Question ${start} of ${total}.`
          : `Questions ${start}–${end} of ${total}.`}{" "}
        Every answer is optional.
      </p>
    </header>
  );
}

function sectionTitle(code: string): string {
  const words = code.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const SUGGESTED_PLACES = [
  "Ahmedabad", "Bengaluru", "Bhopal", "Chandigarh", "Chennai", "Coimbatore",
  "Delhi", "Gurugram", "Hyderabad", "Indore", "Jaipur", "Kochi", "Kolkata",
  "Lucknow", "Mumbai", "Nagpur", "Navi Mumbai", "Noida", "Patna", "Pune",
  "Surat", "Thane", "Vadodara", "Visakhapatnam",
];

function PlacePicker({ value, onChange }: { value: unknown; onChange: (value: unknown) => void }) {
  const selected = Array.isArray(value) ? value.filter((place): place is string => typeof place === "string") : [];
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const trimmed = query.trim().replace(/\s+/g, " ");
  const matches = SUGGESTED_PLACES.filter((place) =>
    place.toLowerCase().includes(trimmed.toLowerCase()) &&
    !selected.some((item) => item.toLowerCase() === place.toLowerCase()),
  ).slice(0, 6);
  const canAddCustom = trimmed.length >= 2 && trimmed.length <= 80 &&
    !/[\d@]/.test(trimmed) &&
    !selected.some((item) => item.toLowerCase() === trimmed.toLowerCase()) &&
    !matches.some((place) => place.toLowerCase() === trimmed.toLowerCase());
  const add = (place: string) => {
    if (selected.length >= 5) return;
    onChange([...selected, place]);
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="max-w-xl">
      {selected.length < 5 && (
        <div className="relative">
          <Search size={17} aria-hidden="true" className="pointer-events-none absolute left-3.5 top-3.5 text-[#788398]" />
          <input
            type="text"
            value={query}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => window.setTimeout(() => setOpen(false), 120)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
              if (event.key === "Enter" && (matches[0] || canAddCustom)) {
                event.preventDefault();
                add(matches[0] ?? trimmed);
              }
            }}
            placeholder="Search a city or place"
            aria-label="Search places to work"
            className="w-full rounded-xl border border-[#E7E0D4] bg-white py-3 pl-10 pr-3 text-[14px] text-[#0A1931] outline-none placeholder:text-[#8891A0] focus:border-[#5F4DB2] focus:ring-2 focus:ring-[#5F4DB2]/10"
          />
          {open && (matches.length > 0 || canAddCustom) && (
            <div id="preferred-places-options" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-[#E7E0D4] bg-white p-1 shadow-lg">
              {matches.map((place) => (
                <button key={place} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => add(place)} className="block w-full rounded-lg px-3 py-2 text-left text-[14px] text-[#0A1931] hover:bg-[#F7F4FC] focus-visible:bg-[#F7F4FC] focus-visible:outline-none">{place}</button>
              ))}
              {canAddCustom && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => add(trimmed)} className="block w-full rounded-lg px-3 py-2 text-left text-[14px] text-[#4A3E8F] hover:bg-[#F7F4FC] focus-visible:bg-[#F7F4FC] focus-visible:outline-none">Add “{trimmed}”</button>}
            </div>
          )}
        </div>
      )}
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selected.map((place) => (
            <span key={place} className="inline-flex items-center gap-1.5 rounded-full border border-[#C9BEEB] bg-[#F1EAF7] px-3 py-1.5 text-[13px] text-[#4A3E8F]">
              {place}
              <button type="button" aria-label={`Remove ${place}`} onClick={() => onChange(selected.filter((item) => item !== place))} className="rounded-full p-0.5 hover:bg-[#E2D8F0] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#5F4DB2]"><X size={13} /></button>
            </span>
          ))}
        </div>
      )}
      <p className="mt-1 text-[12px] text-[#5F6B80]">{selected.length} of 5 places selected</p>
    </div>
  );
}

function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={selected}
      onClick={onClick}
      className={[
        "flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30",
        selected
          ? "border-[#5F4DB2] bg-[#F1EAF7] font-medium text-[#0A1931]"
          : "border-[#E7E0D4] bg-[#FFFCF7] text-[#3A4761] hover:border-[#C9BEEB]",
      ].join(" ")}
    >
      <span
        aria-hidden="true"
        className={[
          "flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2",
          selected ? "border-[#5F4DB2] bg-[#5F4DB2] text-white" : "border-[#BFB5A5] bg-white",
        ].join(" ")}
      >
        {selected ? <Check size={13} strokeWidth={3} /> : null}
      </span>
      {children}
    </button>
  );
}
