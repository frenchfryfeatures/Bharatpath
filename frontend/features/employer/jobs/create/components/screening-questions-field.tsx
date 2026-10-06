"use client";

import { Plus, Trash2 } from "lucide-react";

import {
  QUESTION_TYPE_LABELS,
  optionsOf,
  type QuestionType,
  type ScreeningQuestion,
} from "@/features/jobs/job-details";

import {
  CheckboxRow,
  Field,
  FieldGrid,
  LinesInput,
  SelectInput,
  TextInput,
} from "./job-form-fields";

const MAX_QUESTIONS = 10;
const CHOICE = new Set<QuestionType>(["SINGLE_CHOICE", "MULTIPLE_CHOICE"]);

function newQuestion(): ScreeningQuestion {
  return {
    question: "",
    type: "YES_NO",
    options: [],
    mandatory: true,
    knockout: false,
    accepted_answers: [],
  };
}

export function ScreeningQuestionsField({
  value,
  onChange,
  errors,
  disabled,
}: {
  value: ScreeningQuestion[];
  onChange: (questions: ScreeningQuestion[]) => void;
  errors: Partial<Record<string, string>>;
  disabled?: boolean;
}) {
  const update = (index: number, patch: Partial<ScreeningQuestion>) =>
    onChange(
      value.map((question, at) =>
        at === index ? { ...question, ...patch } : question,
      ),
    );

  return (
    <div className="flex flex-col gap-4">
      {value.length === 0 ? (
        <p className="rounded-[10px] bg-[#f7f8fa] px-4 py-3.5 text-xs leading-[17px] text-[#687386]">
          No screening questions yet. Add up to {MAX_QUESTIONS} questions you
          want every applicant to answer.
        </p>
      ) : null}

      {value.map((question, index) => {
        const isChoice = CHOICE.has(question.type);
        const canKnockout = isChoice || question.type === "YES_NO";
        const answerChoices =
          question.type === "YES_NO"
            ? ["Yes", "No"]
            : question.options.map((option) => option.trim()).filter(Boolean);

        return (
          <div
            key={index}
            className="rounded-[12px] border border-[#e1e5ea] bg-[#fbfcfd] p-4"
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[12px] font-bold text-[#283247]">
                Question {index + 1}
              </span>
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => onChange(value.filter((_, at) => at !== index))}
                  aria-label={`Remove question ${index + 1}`}
                  className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-[#efc8c4] bg-white text-[#b42318] transition hover:bg-[#fff4f2]"
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              ) : null}
            </div>

            <FieldGrid>
              <Field label="Question" required wide error={errors[`screening.${index}`]}>
                <TextInput
                  value={question.question}
                  maxLength={300}
                  disabled={disabled}
                  ariaLabel={`Question ${index + 1}`}
                  placeholder="Are you comfortable working rotational shifts?"
                  onChange={(text) => update(index, { question: text })}
                />
              </Field>

              <Field label="Question type" required>
                <SelectInput<QuestionType>
                  value={question.type}
                  options={optionsOf(QUESTION_TYPE_LABELS)}
                  disabled={disabled}
                  ariaLabel={`Question ${index + 1} type`}
                  onChange={(type) =>
                    update(index, {
                      type,
                      options: CHOICE.has(type) ? question.options : [],
                      knockout:
                        CHOICE.has(type) || type === "YES_NO"
                          ? question.knockout
                          : false,
                      accepted_answers: [],
                    })
                  }
                />
              </Field>

              {isChoice ? (
                <Field label="Options" required hint="One option per line, at least two.">
                  <LinesInput
                    rows={3}
                    value={question.options}
                    disabled={disabled}
                    ariaLabel={`Question ${index + 1} options`}
                    placeholder={"Option A\nOption B"}
                    onChange={(options) => update(index, { options })}
                  />
                </Field>
              ) : null}

              <div className="flex flex-col gap-2 sm:col-span-2 sm:flex-row">
                <div className="flex-1">
                  <CheckboxRow
                    label="Mark as mandatory"
                    checked={question.mandatory}
                    disabled={disabled}
                    onChange={(mandatory) => update(index, { mandatory })}
                  />
                </div>
                <div className="flex-1">
                  <CheckboxRow
                    label="Knockout question"
                    hint={
                      canKnockout
                        ? "Choose which answers pass below."
                        : "Only yes/no and choice questions can knock out."
                    }
                    checked={question.knockout}
                    disabled={disabled || !canKnockout}
                    onChange={(knockout) =>
                      update(index, { knockout, accepted_answers: [] })
                    }
                  />
                </div>
              </div>

              {question.knockout && canKnockout ? (
                <Field
                  label="Answers that pass"
                  required
                  wide
                  hint="Applicants must give one of these answers."
                >
                  <div className="flex flex-wrap gap-2">
                    {answerChoices.length === 0 ? (
                      <span className="text-xs text-[#7b8493]">
                        Add options first.
                      </span>
                    ) : null}
                    {answerChoices.map((answer) => {
                      const selected = question.accepted_answers.includes(answer);
                      return (
                        <button
                          key={answer}
                          type="button"
                          aria-pressed={selected}
                          disabled={disabled}
                          onClick={() =>
                            update(index, {
                              accepted_answers: selected
                                ? question.accepted_answers.filter((a) => a !== answer)
                                : [...question.accepted_answers, answer],
                            })
                          }
                          className={`cursor-pointer rounded-full px-3 py-2 text-xs font-semibold transition disabled:cursor-not-allowed ${
                            selected
                              ? "bg-[#151b2b] text-white"
                              : "bg-[#f4f5f7] text-[#283247] hover:bg-[#e9ecf0]"
                          }`}
                        >
                          {answer}
                        </button>
                      );
                    })}
                  </div>
                </Field>
              ) : null}
            </FieldGrid>
          </div>
        );
      })}

      {!disabled && value.length < MAX_QUESTIONS ? (
        <button
          type="button"
          onClick={() => onChange([...value, newQuestion()])}
          className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-[8px] border border-[#e1e5ea] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#151b2b] transition hover:bg-[#f7f8fa]"
        >
          <Plus size={15} aria-hidden="true" />
          Add screening question
        </button>
      ) : null}

      <p className="text-xs leading-[17px] text-[#7b8493]">
        Questions are saved with the job and shown to your team. Applicants are
        not asked them in the app yet.
      </p>
    </div>
  );
}
