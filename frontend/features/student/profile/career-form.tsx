"use client";
import { useStudentHasAccess } from "@/features/student/onboarding/use-student-access";
import { Fragment, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Mail, Plus, User, X } from "lucide-react";
import { StudentBackButton } from "@/features/student/components/student-back-button";
import { ConversationPrompt } from "./conversation-prompt";
import { conversationQuestion, type ConversationAnswer } from "./conversation-questions";
import { applyCareerAnswer, parseConversationAnswer } from "./conversation-validation";
import { clearOnboardingDraft, readOnboardingDraft, writeOnboardingDraft, type OnboardingDraft } from "./onboarding-draft";
import { AppSelect } from "@/components/ui/app-select";
import { MonthYearSelect } from "@/components/ui/month-year-select";
import { formatSalaryLpaFromRupees, isProfileSalary, parseSalaryLpa, profileFieldLabel, salaryInputFromRupees } from "../salary";
import { PhoneNumberInput } from "@/components/ui/phone-number-input";
import { FormSkeleton } from "@/components/common/loading";
import {
  useGetStudentProfileQuery,
  useUpdateStudentNameMutation,
} from "@/store/student";
import { useAppSelector } from "@/store/hooks";
import { getApiErrorCode, getApiErrorMessage } from "@/lib/api/error-message";
import {
  Field,
  fieldClass,
  fieldBorder,
  PillButton,
  StepHeader,
} from "@/features/student/onboarding/components/ui";
import {
  careerDetailsForSave,
  careerFieldRequired,
  visibleCareerField,
  useGetCareerIdentityQuery,
  useGetCareerFieldsQuery,
  useGetCareerProfileQuery,
  usePrefillCareerProfileMutation,
  useSaveCareerProfileMutation,
  usePreviewSignupResumeMutation,
  useIntakeCareerResumeMutation,
  type CareerDetails,
  type CareerField,
  type CareerProfile,
} from "./career-api";

const sections = [
  { key: "basic", title: "Basic details" },
  { key: "employment", title: "Employment details" },
  { key: "education", title: "Education details" },
  { key: "preferences", title: "Headline and preferences" },
] as const;

function incompleteCareerFields(error: unknown): string[] {
  if (getApiErrorCode(error) !== "career_profile_incomplete") return [];
  if (typeof error !== "object" || error === null || !("data" in error))
    return [];
  const data = error.data;
  if (typeof data !== "object" || data === null || !("params" in data))
    return [];
  const params = data.params;
  if (typeof params !== "object" || params === null || !("fields" in params))
    return [];
  return Array.isArray(params.fields)
    ? params.fields.filter((field): field is string => typeof field === "string")
    : [];
}

export type CareerEditSection =
  | "all"
  | "headline"
  | (typeof sections)[number]["key"];

export function CareerForm({
  resumeVersionId,
  resumeFilename,
  onDone,
  onBack,
  editing = false,
  editSection = "all",
  initialSection = 0,
  onSectionChange,
  onConversationModeChange,
}: {
  resumeVersionId?: string;
  resumeFilename?: string;
  onDone: (profile: CareerProfile) => void;
  onBack: () => void;
  editing?: boolean;
  editSection?: CareerEditSection;
  initialSection?: number;
  onSectionChange?: (section: number) => void;
  onConversationModeChange?: (active: boolean) => void;
}) {
  const fields = useGetCareerFieldsQuery();
  const { hasAccess } = useStudentHasAccess(editing);
  const identity = useGetStudentProfileQuery();
  const email = useAppSelector((state) => state.auth.user?.email ?? "");
  const userId = useAppSelector((state) => state.auth.user?.id);
  const storageKey = userId ? `bharatpath:onboarding:v2:${userId}:${resumeVersionId ?? "new"}` : null;
  const account = useGetCareerIdentityQuery();
  const [saveName] = useUpdateStudentNameMutation();
  const [editedName, setFullName] = useState<string | null>(null);
  const fullName = editedName ?? identity.data?.fullName ?? "";
  const saved = useGetCareerProfileQuery();
  const [prefill, prefillState] = usePrefillCareerProfileMutation();
  const prefillRequest = useRef<{
    id: string;
    promise: Promise<CareerProfile>;
  } | null>(null);
  const [save, saveState] = useSaveCareerProfileMutation();
  const [previewSelectedResume, selectedPreviewState] =
    usePreviewSignupResumeMutation();
  const [intakeSelectedResume, selectedIntakeState] =
    useIntakeCareerResumeMutation();
  const [selectedVersionId, setSelectedVersionId] = useState<string>();
  const [selectedFilename, setSelectedFilename] = useState<string>();
  const [editedDraft, setDraft] = useState<CareerDetails | null>(null);
  const draft = editedDraft ?? saved.data?.details ?? null;
  const [step, setStep] = useState(initialSection);
  const [error, setError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [errorScroll, setErrorScroll] = useState<string[] | null>(null);
  const [listText, setListText] = useState<Record<string, string>>({});
  const [salaryText, setSalaryText] = useState<Record<string, string>>({});
  const [locationInput, setLocationInput] = useState("");
  const [serverRequiresSkills, setServerRequiresSkills] = useState(false);
  const [mode, setMode] = useState<"manual" | "conversation" | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [finalSaving, setFinalSaving] = useState(false);
  const [finishReadyConversation, setFinishReadyConversation] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (!finishReadyConversation) return;
    const timer = setTimeout(() => {
      setFinishReadyConversation(false);
      formRef.current?.requestSubmit();
    }, 0);
    return () => clearTimeout(timer);
  }, [finishReadyConversation]);
  useEffect(() => {
    if (!errorScroll?.length) return;
    const ids = new Set(errorScroll);
    const target = Array.from(formRef.current?.querySelectorAll<HTMLElement>("[id]") ?? [])
      .find((element) => ids.has(element.id));
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }, [errorScroll]);
  const [conversationHistory, setConversationHistory] = useState<ConversationAnswer[]>([]);
  const [conversationInput, setConversationInput] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState("");
  const [attempts, setAttempts] = useState<{ key: string; answer: string; message: string }[]>([]);
  const [draftRestored, setDraftRestored] = useState(false);
  const resumeCheckpoint = useRef<OnboardingDraft | null>(null);
  const completed = useRef(false);
  const skipQuestion = useRef(false);
  const transitionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(transitionTimer.current), []);
  useEffect(() => {
    if (editing || !storageKey) return;
    const timer = setTimeout(() => {
      const restored = readOnboardingDraft(storageKey);
      if (restored) {
        resumeCheckpoint.current = restored.draft;
        setDraft(restored.draft.details);
        setFullName(restored.draft.fullName);
        setConversationHistory(restored.draft.history);
        if (restored.sameVisit) {
          setMode(restored.draft.mode);
          setStep(restored.draft.stepDone ? Math.min(restored.draft.step + 1, sections.length - 1) : restored.draft.step);
          setQuestionIndex(restored.draft.stepDone ? 0 : restored.draft.questionIndex);
          onConversationModeChange?.(restored.draft.mode === "conversation");
          setConversationInput(restored.draft.input);
        } else {
          setMode(null);
          setStep(0);
        }
      }
      setDraftRestored(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [editing, storageKey, onConversationModeChange]);
  useEffect(() => {
    if (editing || !storageKey || !draftRestored || !draft || completed.current || thinking) return;
    const checkpoint = !mode && resumeCheckpoint.current;
    writeOnboardingDraft(storageKey, {
      details: draft, fullName, mode, step: checkpoint ? checkpoint.step : step,
      questionIndex: checkpoint ? checkpoint.questionIndex : questionIndex,
      stepDone: false,
      history: conversationHistory, input: checkpoint ? checkpoint.input : conversationInput,
    });
  }, [editing, storageKey, draftRestored, draft, fullName, mode, step, questionIndex, conversationHistory, conversationInput, thinking]);
  useEffect(() => {
    onSectionChange?.(step);
  }, [step, onSectionChange]);

  useEffect(() => {
    if (!saved.data || editedDraft) return;
    let cancelled = false;
    if (
      !editing &&
      resumeVersionId &&
      saved.data.resume_version_id !== resumeVersionId
    ) {
      if (prefillRequest.current?.id !== resumeVersionId)
        prefillRequest.current = {
          id: resumeVersionId,
          promise: prefill(resumeVersionId).unwrap(),
        };
      prefillRequest.current.promise
        .then((result) => {
          if (!cancelled) setDraft(result.details);
        })
        .catch((failure) => {
          if (!cancelled) {
            setDraft(saved.data!.details);
            setError(
              getApiErrorMessage(
                failure,
                "Resume prefill could not finish. Enter or correct your details below.",
              ),
            );
          }
        });
    }
    return () => {
      cancelled = true;
    };
  }, [saved.data, resumeVersionId, editing, prefill, editedDraft]);

  if (fields.isError || saved.isError)
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-200 bg-white p-6"
      >
        <p>
          Profile details could not be loaded. The updated backend must be
          available.
        </p>
        <button
          type="button"
          className="mt-3 underline"
          onClick={() => {
            void fields.refetch();
            void saved.refetch();
          }}
        >
          Try again
        </button>
      </div>
    );
  if (!draft || !fields.data || prefillState.isLoading || (!editing && storageKey && !draftRestored))
    return (
      <div
        className={editing ? "min-h-72" : "min-h-[calc(100dvh-8rem)]"}
      >
        <FormSkeleton fields={5} />
      </div>
    );
  const section = sections[step];
  const editingAll = editing && editSection === "all";
  const updateEmploymentFields = !editing || editingAll || editSection === "employment";
  const showIdentityFields = section.key === "basic" && (!editing || editingAll);
  const modalFieldClass = editing ? "!rounded-lg !border !px-3 !py-2.5 !text-[13px] !leading-5" : "";
  const maxPassingYear = draft.starting_year ? Math.min(2100, Number(draft.starting_year) + 5) : 2100;
  const sectionFields = fields.data.filter(
    (field) =>
      (editingAll ||
        (editing && editSection === "headline"
          ? field.key === "headline"
          : field.section === section.key &&
            (!editing || field.key !== "headline"))) &&
      (visibleCareerField(field, draft) ||
        (serverRequiresSkills && field.key === "key_skills")),
  );
  const conversational = !editing && step > 0 && mode === "conversation";
  const currentQuestionIndex = Math.min(questionIndex, Math.max(0, sectionFields.length - 1));
  const activeFields = conversational ? sectionFields.slice(currentQuestionIndex, currentQuestionIndex + 1) : sectionFields;
  const lastQuestion = !conversational || currentQuestionIndex >= sectionFields.length - 1;
  const finishing = step === sections.length - 1 && lastQuestion;
  const fieldRequired = (field: CareerField, details: CareerDetails) =>
    careerFieldRequired(field, details) ||
    (conversational && details.work_status === "EXPERIENCED" &&
      (field.key === "experience_years" || field.key === "experience_months")) ||
    (serverRequiresSkills && field.key === "key_skills");
  const busy =
    saveState.isLoading ||
    selectedPreviewState.isLoading ||
    selectedIntakeState.isLoading || thinking || finalSaving;
  const currentField = conversational ? activeFields[0] : undefined;
  const currentValue = currentField ? draft[currentField.key] : null;
  const answerText = conversationInput ?? (currentField?.options.find((option) => option.value === currentValue)?.label ??
    (currentField && isProfileSalary(currentField.key) ? salaryInputFromRupees(currentValue) :
      Array.isArray(currentValue) ? currentValue.join(", ") : String(currentValue ?? "")));
  const update = (key: string, value: CareerDetails[string]) => {
    setDraft((current) => {
      const next = { ...(current ?? draft), [key]: value };
      if (key === "work_status" && value === "FRESHER")
        Object.assign(next, {
          experience_years: 0,
          experience_months: 0,
          currently_employed: "NO",
          company_name: "",
          job_title: "",
          employment_start: "",
          employment_end: "",
          annual_salary: null,
          notice_period: "",
          job_role: "",
        });
      if (updateEmploymentFields && key === "currently_employed" && value === "YES") {
        next.employment_end = "";
        if (next.work_status !== "EXPERIENCED") next.work_status = "EXPERIENCED";
      }
      if (updateEmploymentFields && key === "currently_employed" && value === "NO")
        Object.assign(next, {
          company_name: "",
          job_title: "",
          employment_start: "",
          employment_end: "",
          annual_salary: null,
          notice_period: "",
          job_role: "",
        });
      return next;
    });
    setErrors((current) =>
      key === "currently_employed"
        ? {
            ...current,
            [key]: "",
            company_name: "",
            job_title: "",
            employment_start: "",
            annual_salary: "",
            notice_period: "",
            employment_end: "",
            job_role: "",
          }
        : { ...current, [key]: "" },
    );
  };
  const addPreferredLocation = () => {
    const location = locationInput.trim();
    const locations = Array.isArray(draft.preferred_locations)
      ? draft.preferred_locations
      : [];
    if (
      !location ||
      locations.length >= 5 ||
      locations.some((saved) => saved.toLowerCase() === location.toLowerCase())
    ) return;
    update("preferred_locations", [...locations, location]);
    setLocationInput("");
  };
  const showMissingFields = (missing: string[], details: CareerDetails = draft) => {
    if (editing && !editingAll) return false;
    const first = missing.find((key) =>
      key === "full_name" ||
      fields.data.some(
        (field) =>
          field.key === key &&
          (visibleCareerField(field, details) || key === "key_skills"),
      ),
    );
    if (!first) return false;
    if (missing.includes("key_skills")) setServerRequiresSkills(true);
    setErrors(
      Object.fromEntries(missing.map((key) => [key, "This field is required."])),
    );
    setError("Complete the highlighted profile fields to continue.");
    const sectionKey =
      first === "full_name"
        ? "basic"
        : fields.data.find((field) => field.key === first)?.section;
    const targetStep = sections.findIndex((item) => item.key === sectionKey);
    const targetIndex = fields.data.filter((field) => field.section === sectionKey &&
      (visibleCareerField(field, details) || (missing.includes("key_skills") && field.key === "key_skills")))
      .findIndex((field) => field.key === first);
    if (targetStep >= 0) {
      setDraft(details);
      setStep(targetStep);
    }
    setErrorScroll([mode === "conversation" && targetStep > 0
      ? "conversation-answer"
      : first === "full_name" ? "career-full-name" : `career-${first}`]);
    setQuestionIndex(Math.max(0, targetIndex));
    setConversationInput(null);
    setAttempts([]);
    if (mode === "conversation") {
      setConversationError("Sorry, please correct this answer before we finish your profile.");
    }
    return true;
  };
  /** Open the first unanswered question, carrying prefills through completed sections. */
  const startConversationStep = (target: number, base: ConversationAnswer[], details: CareerDetails = draft): { step: number; questionIndex: number; readyToFinish: boolean } | null => {
    let history = base;
    for (let nextStep = target; nextStep < sections.length; nextStep++) {
      const asked = fields.data.filter((field) => field.section === sections[nextStep].key &&
        (visibleCareerField(field, details) || (serverRequiresSkills && field.key === "key_skills")));
      const firstOpen = asked.findIndex((field) => {
        const value = details[field.key];
        const skipped = history.some((item) => item.key === field.key && item.answer === "Skipped for now");
        if (skipped && !fieldRequired(field, details)) return false;
        if (value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length)) return true;
        const answer = isProfileSalary(field.key) ? salaryInputFromRupees(value) : Array.isArray(value) ? value.join(", ") : String(value);
        return Boolean(parseConversationAnswer(field, answer, fieldRequired(field, details), details).error);
      });
      const lastStep = nextStep === sections.length - 1;
      const shown = firstOpen < 0 && lastStep ? Math.max(0, asked.length - 1) : firstOpen < 0 ? asked.length : firstOpen;
      const seeded: ConversationAnswer[] = asked.slice(0, shown).map((field, position) => {
        const value = details[field.key];
        const previousSkip = history.find((item) => item.key === field.key && item.answer === "Skipped for now");
        return {
          key: field.key, step: nextStep, questionIndex: position, question: conversationQuestion(field),
          answer: previousSkip && !fieldRequired(field, details) ? previousSkip.answer : isProfileSalary(field.key) ? formatSalaryLpaFromRupees(value) : field.options.find((option) => option.value === value)?.label ??
            (Array.isArray(value) ? value.join(", ") : String(value)),
        };
      });
      history = [
        ...history.filter((item) => !seeded.some((answer) => answer.key === item.key)),
        ...seeded,
      ].sort((left, right) => left.step - right.step || left.questionIndex - right.questionIndex);
      if (firstOpen >= 0 || lastStep) {
        const index = firstOpen < 0 ? Math.max(0, asked.length - 1) : firstOpen;
        setConversationHistory(history);
        setStep(nextStep);
        setQuestionIndex(index);
        setConversationInput(null);
        if (lastStep && firstOpen < 0) setFinishReadyConversation(true);
        return { step: nextStep, questionIndex: index, readyToFinish: lastStep && firstOpen < 0 };
      }
    }
    return null;
  };
  const leavesForm = !editing && step === 0;
  const actionRow = <div className="flex items-center gap-3">
    {!leavesForm && <StudentBackButton disabled={busy}
      className={editing ? "!h-9 !rounded-lg !py-2 !text-[13px]" : ""}
      label={editing ? "Close" : "Back"}
      onClick={() => {
        setConversationInput(null);
        setConversationError("");
        if (editing) onBack();
        else if (conversational) {
          setMode(null);
          setStep(0);
          setQuestionIndex(0);
          setAttempts([]);
          setError("");
          setErrors({});
          onConversationModeChange?.(false);
        } else if (step > 0) {
          setStep(step - 1);
          setQuestionIndex(0);
        } else onBack();
      }} />}
    <PillButton type="submit" isLoading={busy} className={`flex-1 ${editing ? "!h-9 !rounded-lg !py-2 !text-[13px]" : ""}`}>
      {editing ? "Save profile" : conversational ? finishing ? "Send answer and finish" : "Send answer" : finishing ? hasAccess ? "Save and continue" : "Save and continue to membership" : "Continue"}
    </PillButton>
  </div>;

  if (!editing && step > 0 && mode === null) return <div className="flex flex-col gap-6">
    <StepHeader step={section.key === "basic" ? "account" : section.key} title="How would you like to complete your profile?" subtitle="Choose a form or a guided conversation for the remaining steps." />
    <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Choose onboarding mode">
      {(["manual", "conversation"] as const).map((option) => <button key={option} type="button"
        onClick={() => {
          setMode(option);
          onConversationModeChange?.(option === "conversation");
          setError("");
          const checkpoint = resumeCheckpoint.current;
          if (option === "conversation" && checkpoint && checkpoint.step > 0) {
            const resumed = startConversationStep(
              checkpoint.stepDone ? Math.min(checkpoint.step + 1, sections.length - 1) : checkpoint.step,
              checkpoint.history,
              checkpoint.details,
            );
            if (resumed && !resumed.readyToFinish && resumed.step === checkpoint.step &&
              resumed.questionIndex === checkpoint.questionIndex) setConversationInput(checkpoint.input);
          } else if (option === "conversation") startConversationStep(1, []);
          resumeCheckpoint.current = null;
        }} className="rounded-2xl border border-[#C9BEEB] bg-white p-5 text-left hover:border-[#5F4DB2] hover:bg-[#F8F5FF]">
        <span className="block font-semibold text-[#5F4DB2]">{option === "manual" ? "Manual Form" : "Conversational Mode"}</span>
        <span className="mt-2 block text-sm text-[#5F6B80]">{option === "manual" ? "Fill in your details in the familiar form." : "Answer one question at a time. Type or choose a suggestion."}</span>
      </button>)}
    </div>
    <StudentBackButton label="Back" onClick={() => setStep(0)} />
  </div>;

  return (
    <form
      ref={formRef}
      noValidate
      className={`flex flex-col ${conversational ? "h-full min-h-0 gap-3" : "gap-6"} ${editing ? "font-sans text-[13px] leading-5" : ""}`}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const pendingLocation = locationInput.trim();
        const savedLocations = Array.isArray(draft.preferred_locations)
          ? draft.preferred_locations
          : [];
        const locationDraft =
          pendingLocation &&
          savedLocations.length < 5 &&
          !savedLocations.some(
            (location) => location.toLowerCase() === pendingLocation.toLowerCase(),
          )
            ? { ...draft, preferred_locations: [...savedLocations, pendingLocation] }
            : draft;
        const submittedDraft = { ...locationDraft };
        if (!conversational) {
          for (const [key, raw] of Object.entries(salaryText)) {
            const salaryField = fields.data.find((field) => field.key === key);
            if (salaryField && !visibleCareerField(salaryField, submittedDraft)) continue;
            if (!raw.trim()) {
              submittedDraft[key] = null;
              continue;
            }
            const parsed = parseSalaryLpa(raw);
            if (parsed.error) {
              setErrors((current) => ({ ...current, [key]: parsed.error }));
              setErrorScroll([`career-${key}`]);
              return;
            }
            submittedDraft[key] = parsed.value!;
          }
        }
        let employmentDetails = submittedDraft;
        const skipping = conversational && skipQuestion.current;
        skipQuestion.current = false;
        if (conversational && currentField) {
          const parsed = parseConversationAnswer(currentField, skipping ? "" : answerText, fieldRequired(currentField, draft), draft);
          if (parsed.error) {
            const message = `Sorry, ${parsed.error.charAt(0).toLowerCase()}${parsed.error.slice(1)}`;
            setConversationError(message);
            setAttempts((list) => [...list, { key: currentField.key, answer: answerText, message }]);
            setConversationInput("");
            setErrorScroll(["conversation-answer"]);
            return;
          }
          employmentDetails = applyCareerAnswer(draft, currentField.key, parsed.value!);
        }
        const nextErrors: Record<string, string> = {};
        for (const field of activeFields)
          if (
            fieldRequired(field, employmentDetails) &&
            ((employmentDetails[field.key] === null || employmentDetails[field.key] === undefined || employmentDetails[field.key] === "") ||
              (Array.isArray(employmentDetails[field.key]) &&
                !(employmentDetails[field.key] as string[]).length))
          )
            nextErrors[field.key] = "This field is required.";
        if (
          activeFields.some((field) => field.key === "phone") &&
          employmentDetails.phone &&
          !/^\+[1-9]\d{7,14}$/.test(String(employmentDetails.phone))
        )
          nextErrors.phone = "Enter a valid mobile number for the selected country.";
        if (showIdentityFields && !fullName.trim())
          nextErrors.full_name = "Enter your full name.";
        if (
          activeFields.some((field) => field.key === "experience_years") &&
          employmentDetails.work_status === "EXPERIENCED" &&
          (typeof employmentDetails.experience_years !== "number" ||
            !Number.isInteger(employmentDetails.experience_years) ||
            employmentDetails.experience_years < 0 ||
            employmentDetails.experience_years > 60)
        )
          nextErrors.experience_years = "Enter a whole number from 0 to 60.";
        if (
          activeFields.some((field) => field.key === "experience_months") &&
          employmentDetails.work_status === "EXPERIENCED" &&
          (typeof employmentDetails.experience_months !== "number" ||
            !Number.isInteger(employmentDetails.experience_months) ||
            employmentDetails.experience_months < 0 ||
            employmentDetails.experience_months > 11)
        )
          nextErrors.experience_months = "Enter a whole number from 0 to 11.";
        if (
          activeFields.some((field) => field.key === (conversational ? "experience_months" : "experience_years")) &&
          employmentDetails.work_status === "EXPERIENCED" &&
          !Number(employmentDetails.experience_years) &&
          !Number(employmentDetails.experience_months) &&
          !nextErrors.experience_years &&
          !nextErrors.experience_months
        )
          nextErrors[conversational ? "experience_months" : "experience_years"] =
            "Enter at least one month of experience, or choose fresher.";
        if (!editing && finishing) {
          for (const field of fields.data) {
            if (!visibleCareerField(field, employmentDetails) && !(serverRequiresSkills && field.key === "key_skills")) continue;
            const value = employmentDetails[field.key];
            const answer = isProfileSalary(field.key) ? salaryInputFromRupees(value) : Array.isArray(value) ? value.join(", ") : String(value ?? "");
            const validation = parseConversationAnswer(field, answer, fieldRequired(field, employmentDetails), employmentDetails);
            if (validation.error) nextErrors[field.key] = validation.error;
          }
          if (employmentDetails.work_status === "EXPERIENCED" && !Number(employmentDetails.experience_years) && !Number(employmentDetails.experience_months))
            nextErrors.experience_months = "Enter at least one month of experience, or choose fresher.";
          if (!fullName.trim())
            nextErrors.full_name = "Enter your full name.";
        }
        if (
          !editing && finishing &&
          Object.keys(nextErrors).some((key) =>
            key === "full_name" ||
            fields.data.some((field) => field.key === key && (field.section !== section.key || (conversational && key !== currentField?.key))),
          )
        ) {
          showMissingFields(Object.keys(nextErrors), employmentDetails);
          return;
        }
        for (const field of activeFields) {
          if (field.key !== "employment_start" && field.key !== "employment_end" && field.key !== "starting_year" && field.key !== "passing_year") continue;
          const value = employmentDetails[field.key];
          if (value === null || value === undefined || value === "") continue;
          const validation = parseConversationAnswer(field, String(value), false, employmentDetails);
          if (validation.error) nextErrors[field.key] = validation.error;
        }
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) {
          setErrorScroll(conversational
            ? ["conversation-answer"]
            : Object.keys(nextErrors).map((key) => key === "full_name" ? "career-full-name" : `career-${key}`));
          if (conversational) {
            const message = `Sorry, ${Object.values(nextErrors)[0]}`;
            setConversationError(message);
            if (currentField) setAttempts((list) => [...list, { key: currentField.key, answer: answerText, message }]);
            setConversationInput("");
          }
          return;
        }
        setError("");
        setConversationError("");
        setAttempts([]);
        setDraft(employmentDetails);
        setLocationInput("");
        let acceptedHistory = conversationHistory;
        if (conversational && currentField) {
          const value = employmentDetails[currentField.key];
          const answer = isProfileSalary(currentField.key) ? formatSalaryLpaFromRupees(value) : currentField.options.find((option) => option.value === value)?.label ??
            (Array.isArray(value) ? value.join(", ") : String(value ?? ""));
          acceptedHistory = [
            ...conversationHistory.filter((item) => item.key !== currentField.key),
            { key: currentField.key, step, questionIndex: currentQuestionIndex,
              question: conversationQuestion(currentField), answer: skipping ? "Skipped for now" : answer || "Skipped for now" },
          ].sort((left, right) => left.step - right.step || left.questionIndex - right.questionIndex);
          setConversationHistory(acceptedHistory);
        }
        if (!editing && !finishing) {
          if (conversational) {
            if (storageKey) writeOnboardingDraft(storageKey, {
              details: employmentDetails, fullName, mode, step,
              questionIndex: currentQuestionIndex,
              stepDone: false,
              history: acceptedHistory,
              input: null,
            });
            setThinking(true);
            transitionTimer.current = setTimeout(() => {
              startConversationStep(step, acceptedHistory, employmentDetails);
              setConversationInput(null);
              setThinking(false);
            }, 550);
          } else {
            setStep(step + 1);
            setQuestionIndex(0);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
          return;
        }
        setFinalSaving(true);
        try {
          if ((showIdentityFields || (!editing && finishing)) && fullName.trim() !== identity.data?.fullName)
            await saveName(fullName.trim()).unwrap();
          const detailsToSave =
            editing && !editingAll
              ? {
                  ...saved.data?.details,
                  ...Object.fromEntries(
                    fields.data
                      .filter((field) =>
                        editSection === "headline"
                          ? field.key === "headline"
                          : field.section === section.key &&
                            field.key !== "headline"
                      )
                      .map((field) => [field.key, employmentDetails[field.key]]),
                  ),
                }
              : employmentDetails;
          const cleanedDetails = careerDetailsForSave(detailsToSave);
          if (serverRequiresSkills)
            cleanedDetails.key_skills = detailsToSave.key_skills;
          const result = await save({
            details: cleanedDetails,
            resume_filename: selectedFilename ?? resumeFilename,
            resume_version_id:
              selectedVersionId ??
              resumeVersionId ??
              saved.data?.resume_version_id,
            complete: editing
              ? Boolean(saved.data?.completed)
              : finishing,
          }).unwrap();
          if (!editing) {
            completed.current = true;
            if (storageKey) clearOnboardingDraft(storageKey);
          }
          onDone(result);
        } catch (failure) {
          const missing = incompleteCareerFields(failure);
          if (missing.length && showMissingFields(missing, employmentDetails)) return;
          setError(
            getApiErrorMessage(failure, "Check your details and try again."),
          );
        } finally {
          setFinalSaving(false);
        }
      }}
    >
      {(editing || !conversational) && <div>
        {editing ? (
          <p className="text-[13px] leading-5 text-[#3A4761]">
            Update your profile details below.
          </p>
        ) : (
          <StepHeader
            step={section.key === "basic" ? "account" : section.key}
            title={section.title}
            subtitle="We filled what we could read from your resume. Review it and add anything missing."
          />
        )}
      </div>}
      {conversational && <ConversationPrompt
        thinking={thinking || saveState.isLoading || finalSaving}
        question={conversationQuestion(activeFields[0])}
        history={conversationHistory.filter((item) =>
          (item.step < step || (item.step === step && item.questionIndex < currentQuestionIndex)) &&
          fields.data.some((field) => field.key === item.key && visibleCareerField(field, draft)))
          .sort((left, right) => left.step - right.step || left.questionIndex - right.questionIndex)
          .map((item) => isProfileSalary(item.key) && /^\d+$/.test(item.answer)
          ? { ...item, answer: formatSalaryLpaFromRupees(Number(item.answer)) }
          : item)}
        disabled={busy}
        retryMessage={conversationError}
        attempts={attempts.filter((item) => item.key === currentField?.key)}
        onEdit={(answer) => {
          setStep(answer.step);
          const visible = fields.data.filter((field) => field.section === sections[answer.step].key &&
            (visibleCareerField(field, draft) || (serverRequiresSkills && field.key === "key_skills")));
          setQuestionIndex(Math.max(0, visible.findIndex((field) => field.key === answer.key)));
          setConversationHistory((history) => history.filter((item) =>
            item.step < answer.step || (item.step === answer.step && item.questionIndex < answer.questionIndex)));
          setAttempts([]);
          setError("");
          setConversationError("");
          setConversationInput(null);
        }}
      >
        <fieldset disabled={busy} className="mt-4 space-y-4">
          {currentField && <>
            {currentField.options.length > 0 && <div role="group" aria-label={`Suggested answers for ${currentField.label}`} className="flex flex-wrap gap-2">
              {currentField.options.map((option) => <button key={option.value} type="button"
                aria-pressed={answerText === option.label}
                onClick={() => {
                  setConversationInput(option.label);
                  setConversationError("");
                  // Submit after React has rendered the selected answer.
                  setTimeout(() => formRef.current?.requestSubmit(), 0);
                }}
                className={`rounded-full border px-4 py-2.5 text-sm font-medium ${answerText === option.label ? "border-[#5F4DB2] bg-[#F1EAF7] text-[#4A3E8F]" : "border-[#C9BEEB] bg-white text-[#3A4761] hover:border-[#5F4DB2]"}`}
              >{option.label}</button>)}
            </div>}
            <label htmlFor="conversation-answer" className="sr-only">{profileFieldLabel(currentField.key, currentField.label)}</label>
            {currentField.type === "month" ? (
              <MonthYearSelect
                key={currentField.key}
                id="conversation-answer"
                label={currentField.label}
                value={answerText}
                onChange={setConversationInput}
                invalid={Boolean(conversationError)}
                describedBy={conversationError ? "conversation-retry" : undefined}
              />
            ) : currentField.type === "tel" ? (
              <PhoneNumberInput
                id="conversation-answer"
                variant="student"
                value={answerText}
                onChange={setConversationInput}
                ariaLabel={currentField.label}
                ariaInvalid={Boolean(conversationError)}
                ariaDescribedBy={conversationError ? "conversation-retry" : undefined}
                inputClassName={`${fieldClass} bg-white ${fieldBorder(Boolean(conversationError))}`}
              />
            ) : (
              <input id="conversation-answer" type="text" value={answerText}
                inputMode={isProfileSalary(currentField.key) ? "decimal" : currentField.type === "number" ? "numeric" : "text"}
                placeholder={isProfileSalary(currentField.key) ? "e.g. 4.5 LPA" : currentField.type === "list" ? "Type answers separated by commas" : "Type your answer here…"}
                aria-invalid={Boolean(conversationError)} aria-describedby={conversationError ? "conversation-retry" : undefined}
                className={`${fieldClass} bg-white ${fieldBorder(Boolean(conversationError))}`}
                onChange={(event) => setConversationInput(event.target.value)} />
            )}
            {!fieldRequired(currentField, draft) && <div className="flex justify-end">
              <button type="button" disabled={busy} className="text-xs text-[#5F6B80] underline underline-offset-4 hover:text-[#5F4DB2] disabled:opacity-50"
                onClick={(event) => { skipQuestion.current = true; event.currentTarget.form?.requestSubmit(); }}>Skip this question</button>
            </div>}
          </>}
          {actionRow}
        </fieldset>
      </ConversationPrompt>}
      {error && (
        <p
          role="alert"
          className="flex gap-2 rounded-xl bg-red-50 p-4 text-sm text-red-700"
        >
          <AlertCircle size={18} className="shrink-0" />
          {error}
        </p>
      )}
      {!conversational && <fieldset disabled={busy} className="grid min-w-0 gap-6">
        {!editing && section.key === "basic" && (
          <Field
            id="career-resume"
            label="Upload your resume"
            hint="Read your PDF or DOCX to fill the fields below, or enter your details yourself."
          >
            <input
              id="career-resume"
              type="file"
              accept=".pdf,.docx"
              disabled={busy}
              className={`${fieldClass} text-[13px]`}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                setError("");
                try {
                  const preview = await previewSelectedResume(file).unwrap();
                  const version = await intakeSelectedResume(file).unwrap();
                  const filled = {
                    ...draft,
                    ...Object.fromEntries(
                      Object.entries(preview.details).filter(
                        ([, value]) =>
                          value !== "" &&
                          value !== null &&
                          (!Array.isArray(value) || value.length),
                      ),
                    ),
                  };
                  setDraft(filled);
                  setSelectedVersionId(version.resume_version_id);
                  setSelectedFilename(file.name);
                  if (!fullName && preview.full_name)
                    setFullName(preview.full_name);
                  setListText({});
                  setSalaryText({});
                  await save({
                    details: careerDetailsForSave(filled),
                    resume_version_id: version.resume_version_id,
                    resume_filename: file.name,
                    complete: false,
                  }).unwrap();
                } catch (failure) {
                  setError(
                    getApiErrorMessage(
                      failure,
                      "Your resume could not be read. Try again or enter your details.",
                    ),
                  );
                }
              }}
            />
            {(selectedPreviewState.isLoading ||
              selectedIntakeState.isLoading) && (
              <p role="status" className="text-[13px] text-[#5F4DB2]">
                Reading your resume and filling your details…
              </p>
            )}
          </Field>
        )}
        {editingAll && (
          <h3 className="text-[16px] font-semibold text-[#0A1931]">
            Basic details
          </h3>
        )}
        {showIdentityFields && (
          <>
            <Field
              id="career-full-name"
              label="Full name *"
              error={errors.full_name}
            >
              <div className="relative">
                <User
                  className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3A4761]"
                  aria-hidden="true"
                />
                <input
                  id="career-full-name"
                  autoComplete="name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  aria-invalid={Boolean(errors.full_name)}
                  aria-describedby={errors.full_name ? "career-full-name-error" : undefined}
                  className={`${fieldClass} ${modalFieldClass} ${fieldBorder(Boolean(errors.full_name))} !pl-12`}
                />
              </div>
            </Field>
            <Field
              id="career-email"
              label="Email ID"
              hint="Your verified account email."
            >
              <div className="relative">
                <Mail
                  className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3A4761]"
                  aria-hidden="true"
                />
                <input
                  id="career-email"
                  type="email"
                  readOnly
                  value={email || account.data?.email || ""}
                  className={`${fieldClass} ${modalFieldClass} border-[#E7E0D4] !pl-12`}
                />
              </div>
            </Field>
          </>
        )}
        {activeFields.map((field, index) => {
          const value = draft[field.key];
          const id = `career-${field.key}`;
          return (
            <Fragment key={field.key}>
              {editingAll &&
                field.section !== "basic" &&
                field.section !== activeFields[index - 1]?.section && (
                  <h3 className="text-[16px] font-semibold text-[#0A1931]">
                    {sections.find((item) => item.key === field.section)?.title}
                  </h3>
                )}
              <Field
              id={id}
              label={`${profileFieldLabel(field.key, field.label)}${fieldRequired(field, draft) ? " *" : ""}`}
              error={errors[field.key]}
              optional={!fieldRequired(field, draft)}
              hint={
                field.type === "list"
                  ? field.key === "preferred_locations"
                    ? "Add up to five preferred work locations."
                    : "Separate skills with commas."
                  : field.type === "month"
                    ? "Month and year"
                    : field.key === "passing_year" && draft.starting_year
                      ? `Graduation must be by ${maxPassingYear}, within 5 years of your starting year.`
                    : undefined
              }
            >
              {field.type === "select" ? (
                <AppSelect
                  id={id}
                  value={String(value || (field.key === "currently_employed" ? "NO" : ""))}
                  onChange={(v) => update(field.key, v)}
                  options={[{ value: "", label: "Select" }, ...field.options]}
                  ariaLabel={field.label}
                  ariaInvalid={Boolean(errors[field.key])}
                  ariaDescribedBy={errors[field.key] ? `${id}-error` : undefined}
                  menuPlacement="auto"
                  portal
                  variant={editing ? "student-compact" : "student"}
                  className={`[&>button]:h-[54px] [&>button]:rounded-[16px] [&>button]:border-[1.5px] [&>button]:px-4 [&>button>span]:font-medium ${editing ? "[&>button]:!h-10 [&>button]:!rounded-lg [&>button]:!border [&>button]:!px-3" : ""}`}
                />
              ) : field.key === "preferred_locations" ? (
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      id={id}
                      type="text"
                      value={locationInput}
                      maxLength={100}
                      disabled={Array.isArray(value) && value.length >= 5}
                      placeholder="Enter a work location"
                      aria-invalid={Boolean(errors[field.key])}
                      aria-describedby={errors[field.key] ? `${id}-error` : `${id}-hint`}
                      className={`${fieldClass} ${modalFieldClass} ${fieldBorder(Boolean(errors[field.key]))} pr-14`}
                      onChange={(event) => setLocationInput(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          addPreferredLocation();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={addPreferredLocation}
                      disabled={!locationInput.trim() || (Array.isArray(value) && value.length >= 5)}
                      aria-label="Add work location"
                      className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-xl text-[#5F4DB2] hover:bg-[#F1EAF7] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Plus size={20} />
                    </button>
                  </div>
                  {Array.isArray(value) && value.length > 0 && (
                    <ul className="flex flex-wrap gap-2" aria-label="Selected work locations">
                      {value.map((location, index) => (
                        <li key={`${location}-${index}`} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#C9BEEB] bg-[#F1EAF7] px-3 py-1.5 text-[13px] font-medium text-[#4A3E8F]">
                          <span className="truncate">{location}</span>
                          <button
                            type="button"
                            onClick={() => update(field.key, value.filter((_, itemIndex) => itemIndex !== index))}
                            aria-label={`Remove ${location}`}
                            className="shrink-0 rounded-full p-0.5 hover:bg-[#E5DCF5]"
                          >
                            <X size={14} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : field.type === "month" ? (
                <MonthYearSelect
                  id={id}
                  label={field.label}
                  value={String(value ?? "")}
                  onChange={(next) => update(field.key, next)}
                  invalid={Boolean(errors[field.key])}
                  describedBy={errors[field.key] ? `${id}-error` : `${id}-hint`}
                  compact={editing}
                />
              ) : field.key === "phone" ? (
                <PhoneNumberInput
                  id={id}
                  variant={editing ? "student-compact" : "student"}
                  value={String(value ?? "")}
                  onChange={(next) => update(field.key, next)}
                  ariaInvalid={Boolean(errors[field.key])}
                  ariaDescribedBy={errors[field.key] ? `${id}-error` : undefined}
                  inputClassName={`${fieldClass} ${editing ? "!px-3 !py-2.5 !text-[13px] !leading-5" : ""} ${fieldBorder(Boolean(errors[field.key]))}`}
                />
              ) : isProfileSalary(field.key) ? (
                <input
                  id={id}
                  type="text"
                  inputMode="decimal"
                  value={salaryText[field.key] ?? salaryInputFromRupees(value)}
                  placeholder="e.g. 4.5 LPA"
                  aria-invalid={Boolean(errors[field.key])}
                  aria-describedby={errors[field.key] ? `${id}-error` : undefined}
                  className={`${fieldClass} ${modalFieldClass} ${fieldBorder(Boolean(errors[field.key]))}`}
                  onChange={(event) => {
                    const raw = event.target.value;
                    setSalaryText((current) => ({ ...current, [field.key]: raw }));
                    if (!raw.trim()) update(field.key, null);
                    else {
                      const parsed = parseSalaryLpa(raw);
                      if (!parsed.error) update(field.key, parsed.value!);
                    }
                  }}
                />
              ) : (
                <div className="relative">
                  <input
                    id={id}
                    type={field.type === "list" ? "text" : field.type}
                    value={field.type === "list" ? (listText[field.key] ?? (Array.isArray(value) ? value.join(", ") : "")) : String(value ?? "")}
                    min={field.key === "passing_year" && draft.starting_year ? Number(draft.starting_year) : field.key === "experience_years" ? 0 : field.key.endsWith("year") ? 1950 : 0}
                    max={
                      field.key === "experience_months"
                        ? 11
                        : field.key === "experience_years"
                          ? 60
                        : field.key === "starting_year"
                          ? new Date().getFullYear()
                          : field.key === "passing_year"
                            ? maxPassingYear
                          : undefined
                    }
                    step={field.key.startsWith("experience_") ? 1 : undefined}
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={
                      errors[field.key] ? `${id}-error` : undefined
                    }
                    className={`${fieldClass} ${modalFieldClass} ${fieldBorder(Boolean(errors[field.key]))}`}
                    onChange={(event) => {
                      const raw = event.target.value;
                      if (field.type === "list") {
                        setListText((current) => ({
                          ...current,
                          [field.key]: raw,
                        }));
                        update(
                          field.key,
                          raw
                            .split(",")
                            .map((item) => item.trim())
                            .filter(Boolean),
                        );
                      } else
                        update(
                          field.key,
                          field.type === "number"
                            ? raw === ""
                              ? field.key.startsWith("experience_")
                                ? 0
                                : null
                              : Number(raw)
                            : raw,
                        );
                    }}
                  />
                </div>
              )}
              </Field>
            </Fragment>
          );
        })}
      </fieldset>}
      {(editingAll || activeFields.some((field) => field.key === "gender")) && (
        <p className="flex items-center gap-2 text-xs text-[#5F6B80]">
          <CheckCircle2 size={16} />
          Salary and gender are optional. Gender does not affect your score.
        </p>
      )}
      {!conversational && actionRow}
    </form>
  );
}
