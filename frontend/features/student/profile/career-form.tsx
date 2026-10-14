"use client";
import { useStudentHasAccess } from "@/features/student/onboarding/use-student-access";
import { Fragment, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Mail, Phone, Plus, User, X } from "lucide-react";
import { StudentBackButton } from "@/features/student/components/student-back-button";
import { ConversationPrompt } from "./conversation-prompt";
import { conversationQuestion, type ConversationAnswer } from "./conversation-questions";
import { applyCareerAnswer, parseConversationAnswer } from "./conversation-validation";
import { clearOnboardingDraft, readOnboardingDraft, writeOnboardingDraft, type OnboardingDraft } from "./onboarding-draft";
import { AppSelect } from "@/components/ui/app-select";
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
}: {
  resumeVersionId?: string;
  resumeFilename?: string;
  onDone: (profile: CareerProfile) => void;
  onBack: () => void;
  editing?: boolean;
  editSection?: CareerEditSection;
  initialSection?: number;
  onSectionChange?: (section: number) => void;
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
  const [listText, setListText] = useState<Record<string, string>>({});
  const [locationInput, setLocationInput] = useState("");
  const [serverRequiresSkills, setServerRequiresSkills] = useState(false);
  const [mode, setMode] = useState<"manual" | "conversation" | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [finalSaving, setFinalSaving] = useState(false);
  const [stepDone, setStepDone] = useState(false);
  const [chipSubmit, setChipSubmit] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // Choosing a suggestion answers the question; wait a render so the form
  // reads the chosen text rather than the previous input.
  useEffect(() => {
    if (!chipSubmit) return;
    setChipSubmit(false);
    formRef.current?.requestSubmit();
  }, [chipSubmit]);
  const [conversationHistory, setConversationHistory] = useState<ConversationAnswer[]>([]);
  const [conversationInput, setConversationInput] = useState<string | null>(null);
  const [conversationError, setConversationError] = useState("");
  const [retryCount, setRetryCount] = useState(0);
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
          setStep(restored.draft.step);
          setQuestionIndex(restored.draft.questionIndex);
          setStepDone(Boolean(restored.draft.stepDone));
          setConversationInput(restored.draft.input);
        } else {
          setMode(null);
          setStep(0);
        }
      }
      setDraftRestored(true);
    }, 0);
    return () => clearTimeout(timer);
  }, [editing, storageKey]);
  useEffect(() => {
    if (editing || !storageKey || !draftRestored || !draft || completed.current || thinking) return;
    const checkpoint = !mode && resumeCheckpoint.current;
    writeOnboardingDraft(storageKey, {
      details: draft, fullName, mode, step: checkpoint ? checkpoint.step : step,
      questionIndex: checkpoint ? checkpoint.questionIndex : questionIndex,
      stepDone: checkpoint ? checkpoint.stepDone : stepDone,
      history: conversationHistory, input: checkpoint ? checkpoint.input : conversationInput,
    });
  }, [editing, storageKey, draftRestored, draft, fullName, mode, step, questionIndex, stepDone, conversationHistory, conversationInput, thinking]);
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
    (conversational && field.key === "experience_months" && details.work_status === "EXPERIENCED" && !Number(details.experience_years)) ||
    (serverRequiresSkills && field.key === "key_skills");
  const busy =
    saveState.isLoading ||
    selectedPreviewState.isLoading ||
    selectedIntakeState.isLoading || thinking || finalSaving;
  const currentField = conversational ? activeFields[0] : undefined;
  const currentValue = currentField ? draft[currentField.key] : null;
  const answerText = conversationInput ?? (currentField?.options.find((option) => option.value === currentValue)?.label ??
    (Array.isArray(currentValue) ? currentValue.join(", ") : String(currentValue ?? "")));
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
  const showMissingFields = (missing: string[]) => {
    if (editing && !editingAll) return false;
    const first = missing.find((key) =>
      key === "full_name" ||
      fields.data.some(
        (field) =>
          field.key === key &&
          (visibleCareerField(field, draft) || key === "key_skills"),
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
    if (targetStep >= 0) setStep(targetStep);
    const targetIndex = fields.data.filter((field) => field.section === sectionKey &&
      (visibleCareerField(field, draft) || (missing.includes("key_skills") && field.key === "key_skills")))
      .findIndex((field) => field.key === first);
    setQuestionIndex(Math.max(0, targetIndex));
    setConversationInput(null);
    if (mode === "conversation") {
      setConversationError("Sorry, please correct this answer before we finish your profile.");
      setRetryCount((count) => count + 1);
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    return true;
  };
  /**
   * Opens a step's chat where the answers run out: questions the profile
   * already answers (from the resume or an earlier save) are shown as chat
   * turns, and the first unanswered one is asked. A step with nothing left to
   * ask goes straight to its closing message.
   */
  const startConversationStep = (target: number, base: ConversationAnswer[]) => {
    const asked = fields.data.filter((field) => field.section === sections[target].key && visibleCareerField(field, draft));
    const answered = (field: CareerField) => {
      const value = draft[field.key];
      return !(value === null || value === undefined || value === "" || (Array.isArray(value) && !value.length));
    };
    const firstOpen = asked.findIndex((field) => !answered(field));
    const lastStep = target === sections.length - 1;
    const complete = firstOpen < 0;
    const shown = complete ? asked.length : firstOpen;
    const seeded: ConversationAnswer[] = asked.slice(0, shown).map((field, position) => {
      const value = draft[field.key];
      return {
        key: field.key, step: target, questionIndex: position, question: conversationQuestion(field),
        answer: field.options.find((option) => option.value === value)?.label ??
          (Array.isArray(value) ? value.join(", ") : String(value)),
      };
    });
    // The last step still ends with its own answer and the save, so keep its final question open.
    const keep = complete && lastStep ? seeded.slice(0, -1) : seeded;
    setConversationHistory([...base.filter((item) => item.step !== target), ...keep]);
    setStep(target);
    setQuestionIndex(complete ? Math.max(0, asked.length - 1) : firstOpen);
    setStepDone(complete && !lastStep && asked.length > 0);
    setConversationInput(null);
  };
  const leavesForm = !editing && step === 0 && !(conversational && currentQuestionIndex > 0);
  const actionRow = <div className="flex items-center gap-3">
    {!leavesForm && <StudentBackButton disabled={busy}
      className={editing ? "!h-9 !rounded-lg !py-2 !text-[13px]" : ""}
      label={editing ? "Close" : "Back"}
      onClick={() => {
        setConversationInput(null);
        setConversationError("");
        if (editing) onBack();
        else if (conversational && stepDone) setStepDone(false);
        else if (conversational && currentQuestionIndex > 0) setQuestionIndex(currentQuestionIndex - 1);
        else if (step > 0) {
          const previousFields = fields.data.filter((field) => field.section === sections[step - 1].key && visibleCareerField(field, draft));
          setStep(step - 1);
          setStepDone(false);
          setQuestionIndex(conversational ? Math.max(0, previousFields.length - 1) : 0);
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
          setError("");
          const checkpoint = resumeCheckpoint.current;
          if (option === "conversation" && checkpoint && checkpoint.step > 0) {
            setStep(checkpoint.step);
            setQuestionIndex(checkpoint.questionIndex);
            setStepDone(Boolean(checkpoint.stepDone));
            setConversationInput(checkpoint.input);
          } else startConversationStep(1, []);
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
      className={`flex flex-col gap-6 ${editing ? "font-sans text-[13px] leading-5" : ""}`}
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const pendingLocation = locationInput.trim();
        const savedLocations = Array.isArray(draft.preferred_locations)
          ? draft.preferred_locations
          : [];
        const submittedDraft =
          pendingLocation &&
          savedLocations.length < 5 &&
          !savedLocations.some(
            (location) => location.toLowerCase() === pendingLocation.toLowerCase(),
          )
            ? { ...draft, preferred_locations: [...savedLocations, pendingLocation] }
            : draft;
        let employmentDetails = submittedDraft;
        const skipping = conversational && skipQuestion.current;
        skipQuestion.current = false;
        if (conversational && currentField) {
          const parsed = parseConversationAnswer(currentField, skipping ? "" : answerText, !skipping && fieldRequired(currentField, draft), draft);
          if (parsed.error) {
            const message = `Sorry, ${parsed.error.charAt(0).toLowerCase()}${parsed.error.slice(1)}`;
            setConversationError(message);
            setAttempts((list) => [...list, { key: currentField.key, answer: answerText, message }]);
            setConversationInput("");
            setRetryCount((count) => count + 1);
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
          nextErrors.phone =
            "Use international format, for example +919876543210.";
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
            const validation = parseConversationAnswer(field, Array.isArray(value) ? value.join(", ") : String(value ?? ""), fieldRequired(field, employmentDetails), employmentDetails);
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
          showMissingFields(Object.keys(nextErrors));
          return;
        }
        const validEmploymentMonth = (value: unknown) =>
          typeof value === "string" &&
          /^(?:19|20)\d{2}-(?:0[1-9]|1[0-2])$/.test(value);
        if (
          activeFields.some((field) => field.key === "employment_start") &&
          employmentDetails.employment_start &&
          !validEmploymentMonth(employmentDetails.employment_start)
        )
          nextErrors.employment_start = "Enter a valid month between 1900 and 2099.";
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) {
          if (conversational) {
            const message = `Sorry, ${Object.values(nextErrors)[0]}`;
            setConversationError(message);
            if (currentField) setAttempts((list) => [...list, { key: currentField.key, answer: answerText, message }]);
            setConversationInput("");
            setRetryCount((count) => count + 1);
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
          const answer = currentField.options.find((option) => option.value === value)?.label ??
            (Array.isArray(value) ? value.join(", ") : String(value ?? ""));
          const existing = conversationHistory.findIndex((item) => item.key === currentField.key);
          const previous = existing < 0 ? conversationHistory : conversationHistory.slice(0, existing);
          acceptedHistory = [...previous, { key: currentField.key, step, questionIndex: currentQuestionIndex,
            question: conversationQuestion(currentField), answer: skipping ? "Skipped for now" : answer || "Skipped for now" }];
          setConversationHistory(acceptedHistory);
        }
        if (!editing && !finishing) {
          if (conversational) {
            // Re-evaluate the branch using the accepted answer, not the previous draft.
            const nextFields = fields.data.filter((field) => field.section === section.key &&
              (visibleCareerField(field, employmentDetails) || (serverRequiresSkills && field.key === "key_skills")));
            const nextIndex = nextFields.findIndex((field) => field.key === currentField?.key) + 1;
            const sectionEnds = nextIndex >= nextFields.length;
            // The step's chat ends with a closing message; the next step starts
            // a fresh chat only when the candidate presses Continue.
            if (storageKey) writeOnboardingDraft(storageKey, {
              details: employmentDetails, fullName, mode, step,
              questionIndex: sectionEnds ? currentQuestionIndex : nextIndex,
              stepDone: sectionEnds,
              history: acceptedHistory,
              input: null,
            });
            setThinking(true);
            transitionTimer.current = setTimeout(() => {
              if (sectionEnds) setStepDone(true);
              else setQuestionIndex(nextIndex);
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
          if (missing.length && showMissingFields(missing)) return;
          setError(
            getApiErrorMessage(failure, "Check your details and try again."),
          );
        } finally {
          setFinalSaving(false);
        }
      }}
    >
      <div>
        {editing ? (
          <p className="text-[13px] leading-5 text-[#3A4761]">
            Update your profile details below.
          </p>
        ) : (
          <StepHeader
            step={section.key === "basic" ? "account" : section.key}
            title={section.title}
            subtitle={conversational ? "Answer a few quick questions to complete your profile." : "We filled what we could read from your resume. Review it and add anything missing."}
          />
        )}
      </div>
      {conversational && <ConversationPrompt
        thinking={thinking || saveState.isLoading || finalSaving}
        question={conversationQuestion(activeFields[0])}
        progress={`Step ${step + 1} of 4`}
        closing={stepDone ? `Thanks! That covers ${section.title.toLowerCase()}. Ready for the next step?` : undefined}
        history={conversationHistory}
        stepTitles={sections.map((item) => item.title)}
        disabled={busy}
        retryMessage={conversationError}
        attempts={attempts.filter((item) => item.key === currentField?.key)}
        retryCount={retryCount}
        onEdit={(answer) => {
          setStep(answer.step);
          setStepDone(false);
          const visible = fields.data.filter((field) => field.section === sections[answer.step].key &&
            (visibleCareerField(field, draft) || (serverRequiresSkills && field.key === "key_skills")));
          setQuestionIndex(Math.max(0, visible.findIndex((field) => field.key === answer.key)));
          setConversationHistory((history) => history.slice(0, history.findIndex((item) => item.key === answer.key)));
          setAttempts([]);
          setError("");
          setConversationError("");
          setConversationInput(null);
        }}
      >
        <fieldset disabled={busy} className="mt-4 space-y-4">
          {stepDone ? <div className="flex items-center gap-3">
            <StudentBackButton disabled={busy} label="Back" onClick={() => { setStepDone(false); setConversationError(""); }} />
            <PillButton type="button" className="flex-1" isLoading={saveState.isLoading} onClick={async () => {
              // The step's one save: nothing is sent while its questions are answered.
              try {
                const cleaned = careerDetailsForSave(draft);
                if (serverRequiresSkills) cleaned.key_skills = draft.key_skills;
                await save({
                  details: cleaned,
                  resume_filename: selectedFilename ?? resumeFilename,
                  resume_version_id: selectedVersionId ?? resumeVersionId ?? saved.data?.resume_version_id,
                  complete: false,
                }).unwrap();
              } catch (failure) {
                setError(getApiErrorMessage(failure, "Check your details and try again."));
                return;
              }
              setError("");
              setStepDone(false);
              startConversationStep(step + 1, conversationHistory);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}>Continue</PillButton>
          </div> : currentField && <>
            {currentField.options.length > 0 && <div role="group" aria-label={`Suggested answers for ${currentField.label}`} className="flex flex-wrap gap-2">
              {currentField.options.map((option) => <button key={option.value} type="button"
                aria-pressed={answerText === option.label}
                onClick={() => { setConversationInput(option.label); setConversationError(""); setChipSubmit(true); }}
                className={`rounded-full border px-4 py-2.5 text-sm font-medium ${answerText === option.label ? "border-[#5F4DB2] bg-[#F1EAF7] text-[#4A3E8F]" : "border-[#C9BEEB] bg-white text-[#3A4761] hover:border-[#5F4DB2]"}`}
              >{option.label}</button>)}
            </div>}
            <label htmlFor="conversation-answer" className="sr-only">{currentField.label}</label>
            <input id="conversation-answer" type="text" value={answerText}
              inputMode={currentField.type === "number" ? "numeric" : currentField.type === "tel" ? "tel" : "text"}
              placeholder={currentField.type === "month" ? "Type a month, e.g. 2024-06" : currentField.type === "list" ? "Type answers separated by commas" : "Type your answer here…"}
              aria-invalid={Boolean(conversationError)} aria-describedby={conversationError ? "conversation-retry" : undefined}
              className={`${fieldClass} bg-white ${fieldBorder(Boolean(conversationError))}`}
              onChange={(event) => setConversationInput(event.target.value)} />
            {!careerFieldRequired(currentField, draft) && <div className="flex justify-end">
              <button type="button" disabled={busy} className="text-xs text-[#5F6B80] underline underline-offset-4 hover:text-[#5F4DB2] disabled:opacity-50"
                onClick={(event) => { skipQuestion.current = true; event.currentTarget.form?.requestSubmit(); }}>Skip this question</button>
            </div>}
          </>}
          {!stepDone && actionRow}
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
              label={`${field.label}${fieldRequired(field, draft) ? " *" : ""}`}
              error={errors[field.key]}
              optional={!fieldRequired(field, draft)}
              hint={
                field.type === "list"
                  ? field.key === "preferred_locations"
                    ? "Add up to five preferred work locations."
                    : "Separate skills with commas."
                  : field.type === "month"
                    ? "Month and year"
                    : undefined
              }
            >
              {field.type === "select" ? (
                <AppSelect
                  value={String(value || (field.key === "currently_employed" ? "NO" : ""))}
                  onChange={(v) => update(field.key, v)}
                  options={[{ value: "", label: "Select" }, ...field.options]}
                  ariaLabel={field.label}
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
              ) : (
                <div className="relative">
                  {field.key === "phone" && (
                    <Phone
                      className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3A4761]"
                      aria-hidden="true"
                    />
                  )}
                  <input
                    id={id}
                    type={field.type === "list" ? "text" : field.type}
                    value={field.type === "list" ? (listText[field.key] ?? (Array.isArray(value) ? value.join(", ") : "")) : String(value ?? "")}
                    min={field.key === "experience_years" ? 0 : field.key.endsWith("year") ? 1950 : 0}
                    max={
                      field.key === "experience_months"
                        ? 11
                        : field.key === "experience_years"
                          ? 60
                        : field.key.endsWith("year")
                          ? 2100
                          : undefined
                    }
                    step={field.key.startsWith("experience_") ? 1 : undefined}
                    aria-invalid={Boolean(errors[field.key])}
                    aria-describedby={
                      errors[field.key] ? `${id}-error` : undefined
                    }
                    className={`${fieldClass} ${modalFieldClass} ${fieldBorder(Boolean(errors[field.key]))} ${field.key === "phone" ? "!pl-12" : ""}`}
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
