"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Clock, EyeOff, Lock } from "lucide-react";

import {
  useGetQuestionnaireQuery,
  useSaveQuestionnaireAnswersMutation,
  useSubmitQuestionnaireMutation,
} from "@/store/student";
import { getApiErrorMessage } from "@/lib/api/error-message";
import type {
  QuestionnaireQuestion,
  QuestionnaireView,
} from "@/features/student/types";
import {
  CommerceBadge,
  EmptyState,
  NoteStrip,
  PillButton,
  StudentCard,
} from "@/features/student/components";
import { StudentPage, StudentTopBar } from "@/features/student/shell";

export function AttributeIntro() {
  const questionnaire = useGetQuestionnaireQuery();

  return (
    <StudentPage>
      <div className="flex flex-col gap-5">
        <StudentTopBar
          title="Attribute check"
          right={<CommerceBadge>Included</CommerceBadge>}
        />
        {questionnaire.isLoading ? (
          <StudentCard>Loading questionnaire…</StudentCard>
        ) : questionnaire.error ? (
          <EmptyState
            title="Questionnaire unavailable"
            message={getApiErrorMessage(
              questionnaire.error,
              "Could not load the questionnaire.",
            )}
          />
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

  const questions = useMemo(
    () => questionnaire.sections.flatMap((section) => section.questions),
    [questionnaire.sections],
  );
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
        {questionnaire.submitted ? (
          <StudentCard className="flex flex-col items-center gap-3 text-center">
            <CheckCircle2 size={28} className="text-[#1F6B45]" />
            <h2 className="text-[20px] font-bold text-[#0A1931]">
              Attribute check complete
            </h2>
            <p className="text-[14px] text-[#5F6B80]">
              Your responses were submitted successfully.
            </p>
          </StudentCard>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <IntroFact icon={<Clock size={18} />}>
                {questions.length} questions
              </IntroFact>
              <IntroFact icon={<EyeOff size={18} />}>
                Employers see only a badge
              </IntroFact>
              <IntroFact icon={<Lock size={18} />}>
                Your score does not move
              </IntroFact>
            </div>

            <div className="flex flex-col gap-4">
              {questionnaire.sections.map((section) => (
                <StudentCard key={section.code} className="flex flex-col gap-5">
                  {section.questions.map((question, index) => (
                    <QuestionField
                      key={question.key}
                      number={index + 1}
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
                </StudentCard>
              ))}
            </div>

            {actionError ? (
              <NoteStrip tone="amber">
                {getApiErrorMessage(
                  actionError,
                  "Could not save your answers.",
                )}
              </NoteStrip>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <PillButton
                variant="secondary"
                className="flex-1"
                disabled={saveState.isLoading || submitState.isLoading}
                onClick={() => void save()}
              >
                Save for later
              </PillButton>
              <PillButton
                className="flex-1"
                disabled={
                  missingRequired || saveState.isLoading || submitState.isLoading
                }
                onClick={() => void finish()}
              >
                Submit answers
              </PillButton>
            </div>
          </>
        )}
    </>
  );
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
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-[14px] font-semibold text-[#0A1931]">
        {number}. {question.prompt}
        {question.required ? " *" : ""}
      </legend>
      {question.helpText ? (
        <p className="text-[12px] text-[#5F6B80]">{question.helpText}</p>
      ) : null}
      {question.type === "SINGLE" ? (
        <div className="flex flex-wrap gap-2">
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
        <div className="flex flex-wrap gap-2">
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
      ) : null}
      {question.type === "BOOLEAN" ? (
        <div className="flex gap-2">
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
          onChange={(event) =>
            onChange(event.target.value === "" ? "" : Number(event.target.value))
          }
          className="rounded-xl border border-[#E7E0D4] px-3 py-2.5 text-[14px] outline-none focus:border-[#5F4DB2]"
        />
      ) : null}
      {question.type === "TEXT" ? (
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          className="rounded-xl border border-[#E7E0D4] px-3 py-2.5 text-[14px] outline-none focus:border-[#5F4DB2]"
        />
      ) : null}
    </fieldset>
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
      onClick={onClick}
      className={[
        "cursor-pointer rounded-full border px-3 py-2 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30",
        selected
          ? "border-[#5F4DB2] bg-[#F1EAF7] text-[#4A3E8F] hover:bg-[#E8DEF3]"
          : "border-[#E7E0D4] bg-white text-[#3A4761] hover:border-[#C9BEEB] hover:bg-[#F7F4EC] hover:text-[#0A1931]",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function IntroFact({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <StudentCard className="flex items-center gap-2 text-[13px] text-[#3A4761]">
      <span className="text-[#5F4DB2]">{icon}</span>
      {children}
    </StudentCard>
  );
}
