"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Download, Loader2, Plus, RotateCcw, Save, Send, Trash2, X } from "lucide-react";

import type { StructuredResume } from "@/components/resume/structured-resume";
import { languageProficiencyOptions } from "@/components/resume/language-proficiency";
import { AppSelect } from "@/components/ui/app-select";
import { PhoneNumberInput } from "@/components/ui/phone-number-input";
import { ConfirmModal } from "@/components/ui/confirm-modal";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { showErrorFeedback, showSuccessFeedback } from "@/lib/feedback/success-feedback";
import {
  useDownloadBuilderMutation,
  useGetBuilderDraftQuery,
  useGetBuilderTemplatesQuery,
  useKeepBuilderDraftMutation,
  usePreviewBuilderMutation,
  usePushBuilderMutation,
  useResetBuilderDraftMutation,
  useSaveBuilderDraftMutation,
  type BuilderPush,
  type BuilderTemplateKey,
} from "@/store/student";

type Experience = StructuredResume["experience"][number];
type Education = StructuredResume["education"][number];
type Project = StructuredResume["projects"][number];
type Certification = StructuredResume["certifications"][number];
type Language = StructuredResume["languages"][number];
type OtherSection = StructuredResume["other_sections"][number];
type RowErrors = Record<string, string>;

const required = (value: string, label: string) => value.trim() ? "" : `Enter ${label}.`;
const monthDateError = (value: string, label: string, isRequired = true) => {
  if (!value) return isRequired ? `Select ${label}.` : "";
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return "";
  if (/^\d{4}$/.test(value)) return `Select a month for ${label}.`;
  if (/^-(0[1-9]|1[0-2])$/.test(value)) return `Select a year for ${label}.`;
  return `Select a year and month for ${label}.`;
};
const invalidOrder = (start: string, end: string) => {
  if (!start || !end) return false;
  if (start.slice(0, 4) !== end.slice(0, 4)) return start.slice(0, 4) > end.slice(0, 4);
  return start.length === 7 && end.length === 7 && start > end;
};
const rowHasErrors = (errors: RowErrors) => Object.values(errors).some(Boolean);

const validateExperience = (item: Experience): RowErrors => ({
  job_title: required(item.job_title, "a job title"),
  company: required(item.company, "a company"),
  start_date: monthDateError(item.start_date, "a start date"),
  end_date: item.is_current ? "" : monthDateError(item.end_date, "an end date") || (invalidOrder(item.start_date, item.end_date) ? "End date must follow the start date." : ""),
});
const validateEducation = (item: Education): RowErrors => ({
  qualification: required(item.qualification, "a qualification"),
  institution: required(item.institution, "an institution"),
  start_date: required(item.start_date, "a start year"),
  end_date: required(item.end_date, "an end or expected year") || (invalidOrder(item.start_date, item.end_date) ? "End year must follow the start year." : ""),
});
const validateProject = (item: Project): RowErrors => ({
  name: required(item.name, "a project name"),
  description: required(item.description, "a project description"),
  start_date: monthDateError(item.start_date, "a start date", false),
  end_date: monthDateError(item.end_date, "an end date", false) || (invalidOrder(item.start_date, item.end_date) ? "End date must follow the start date." : ""),
});
const validateCertification = (item: Certification): RowErrors => ({
  name: required(item.name, "a certification name"),
  issuer: required(item.issuer, "an issuer"),
  issue_date: monthDateError(item.issue_date, "an issue date"),
  expiry_date: monthDateError(item.expiry_date, "an expiry date", false) || (invalidOrder(item.issue_date, item.expiry_date) ? "Expiry date must follow the issue date." : ""),
});
const validateLanguage = (item: Language): RowErrors => ({
  name: required(item.name, "a language"),
  proficiency: required(item.proficiency, "a proficiency"),
});
const validateOtherSection = (item: OtherSection): RowErrors => ({
  heading: required(item.heading, "a section heading"),
});

function hasInvalidRows(resume: StructuredResume) {
  return resume.experience.some((item) => rowHasErrors(validateExperience(item)))
    || resume.education.some((item) => rowHasErrors(validateEducation(item)))
    || resume.projects.some((item) => rowHasErrors(validateProject(item)))
    || resume.certifications.some((item) => rowHasErrors(validateCertification(item)))
    || resume.languages.some((item) => rowHasErrors(validateLanguage(item)))
    || resume.other_sections.some((item) => rowHasErrors(validateOtherSection(item)));
}

const input =
  "w-full rounded-lg border border-[#DDD6C7] bg-white px-3 py-2 text-[14px] text-[#0A1931] outline-none transition placeholder:text-[#9AA1AE] focus:border-[#5F4DB2] focus:ring-2 focus:ring-[#5F4DB2]/15";

const blank = {
  experience: (): Experience => ({ job_title: "", company: "", location: "", employment_type: "", start_date: "", end_date: "", is_current: false, description: "", highlights: [], skills_used: [] }),
  education: (): Education => ({ qualification: "", field_of_study: "", institution: "", location: "", start_date: "", end_date: "", grade: "", description: "" }),
  project: (): Project => ({ name: "", role: "", description: "", technologies: [], url: "", start_date: "", end_date: "" }),
  certification: (): Certification => ({ name: "", issuer: "", issue_date: "", expiry_date: "", credential_id: "", url: "" }),
  language: (): Language => ({ name: "", proficiency: "" }),
  otherSection: (): OtherSection => ({ heading: "", items: [] }),
};

/**
 * The resume builder: a form on the left, the rendered resume on the right.
 * Template and content changes stay in the editor until the candidate saves
 * or submits them.
 */
export function ResumeBuilderStep({
  onBack,
  onSubmitted,
  initialTemplate,
  profileMode = false,
  profileSubmissionLabel,
  profileSubmissionNotice,
  onBeforeSubmit,
  focusSection,
}: {
  onBack: () => void;
  onSubmitted: (result: BuilderPush) => void | Promise<void>;
  initialTemplate?: BuilderTemplateKey;
  profileMode?: boolean;
  /** Overrides the profile submission button label. */
  profileSubmissionLabel?: string;
  profileSubmissionNotice?: string;
  /** Runs immediately before saving/pushing a profile resume. */
  onBeforeSubmit?: () => Promise<boolean>;
  /** The builder section to scroll to when opened from a builder resume review. */
  focusSection?: string;
}) {
  const draftQuery = useGetBuilderDraftQuery();
  const templates = useGetBuilderTemplatesQuery();
  const [saveDraft, saveState] = useSaveBuilderDraftMutation();
  const [resetDraft, resetState] = useResetBuilderDraftMutation();
  const [keepDraft, keepState] = useKeepBuilderDraftMutation();
  const [preview, previewState] = usePreviewBuilderMutation();
  const [download, downloadState] = useDownloadBuilderMutation();
  const [push, pushState] = usePushBuilderMutation();

  const [content, setContent] = useState<StructuredResume | null>(null);
  const [template, setTemplate] = useState<BuilderTemplateKey>("classic");
  const [savedSnapshot, setSavedSnapshot] = useState("");
  const [pages, setPages] = useState<{ mime: string; pages: string[] } | null>(null);
  const [error, setError] = useState("");
  const [mobileTab, setMobileTab] = useState<"edit" | "preview">("edit");
  const [editorKey, setEditorKey] = useState(0);
  const [resetOpen, setResetOpen] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [entryTemplateSave, setEntryTemplateSave] = useState<"idle" | "saving" | "error" | "done">("idle");
  const [entryTemplateError, setEntryTemplateError] = useState("");
  const loaded = useRef(false);
  const previewSequence = useRef(0);
  const focusedSection = useRef<string | null>(null);
  const editorScrollRef = useRef<HTMLDivElement>(null);

  const snapshot = (resume: StructuredResume, key: BuilderTemplateKey) => JSON.stringify([key, resume]);
  const selectedTemplate = template;
  const dirty = content !== null && snapshot(content, selectedTemplate) !== savedSnapshot;
  const busy = saveState.isLoading || pushState.isLoading || downloadState.isLoading || resetState.isLoading || keepState.isLoading || finalizing;

  const draw = async (resume: StructuredResume, key: BuilderTemplateKey) => {
    const sequence = ++previewSequence.current;
    setPages(null);
    try {
      const result = await preview({ template_key: key, content: resume }).unwrap();
      if (sequence === previewSequence.current) setPages({ mime: result.mime, pages: result.pages });
    } catch (failure) {
      if (sequence === previewSequence.current) showErrorFeedback(getApiErrorMessage(failure, "The preview could not be drawn."));
    }
  };

  const saveEntryTemplate = async (resume: StructuredResume, key: BuilderTemplateKey) => {
    setEntryTemplateSave("saving");
    setEntryTemplateError("");
    try {
      const result = await saveDraft({ template_key: key, content: resume }).unwrap();
      setContent(result.content);
      setTemplate(result.template_key);
      setSavedSnapshot(snapshot(result.content, result.template_key));
      await draw(result.content, result.template_key);
      setEntryTemplateSave("done");
    } catch (failure) {
      setEntryTemplateError(getApiErrorMessage(failure, "The selected template could not be saved. Please try again."));
      setEntryTemplateSave("error");
    }
  };

  // First load: show the draft (or the first draft from onboarding) and draw it once.
  useEffect(() => {
    if (!draftQuery.data || loaded.current) return;
    loaded.current = true;
    const { content: initial, template_key, saved } = draftQuery.data;
    setContent(initial);
    const chosenTemplate = initialTemplate ?? template_key;
    setTemplate(chosenTemplate);
    // An unsaved first draft counts as changed, so the candidate is nudged to save it.
    setSavedSnapshot(saved ? snapshot(initial, template_key) : "");
    queueMicrotask(() => {
      if (profileMode && chosenTemplate !== template_key) {
        void saveEntryTemplate(initial, chosenTemplate);
      } else {
        void draw(initial, chosenTemplate);
      }
    });
  }, [draftQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focusSection || !content || focusedSection.current === focusSection) return;
    focusedSection.current = focusSection;
    const timer = window.setTimeout(() => {
      const editorPane = editorScrollRef.current;
      const section = document.getElementById(`builder-section-${focusSection}`);
      if (editorPane && section) {
        const paneTop = editorPane.getBoundingClientRect().top;
        const sectionTop = section.getBoundingClientRect().top;
        editorPane.scrollTo({ top: editorPane.scrollTop + sectionTop - paneTop - 16, behavior: "smooth" });
      }
      section?.querySelector<HTMLElement>("input, textarea, button")?.focus({ preventScroll: true });
    }, 100);
    return () => window.clearTimeout(timer);
  }, [content, focusSection]);

  const validateBeforeAction = () => {
    if (!content) return false;
    if (content.full_name.trim() && !hasInvalidRows(content)) return true;
    setShowValidation(true);
    setMobileTab("edit");
    setError("Complete or remove the highlighted entries before continuing.");
    requestAnimationFrame(() => {
      const first = document.querySelector<HTMLElement>('[data-resume-invalid="true"]');
      (first?.matches("input, textarea, button") ? first : first?.querySelector<HTMLElement>("input, textarea, button"))?.focus();
    });
    return false;
  };

  const save = async (): Promise<boolean> => {
    if (!content || !validateBeforeAction()) return false;
    setError("");
    try {
      const result = await saveDraft({ template_key: selectedTemplate, content }).unwrap();
      setSavedSnapshot(snapshot(result.content, result.template_key));
      setContent(result.content);
      setTemplate(result.template_key);
      setShowValidation(false);
      await draw(result.content, result.template_key);
      return true;
    } catch (failure) {
      const message = getApiErrorMessage(failure, "Your resume could not be saved. Check the details and try again.");
      setError(message);
      showErrorFeedback(message);
      return false;
    }
  };

  const onSave = async () => {
    if (await save()) showSuccessFeedback(profileMode
      ? "Draft saved. Press Save & update score to use it on your profile."
      : "Draft saved.");
  };

  const needsSave = dirty || savedSnapshot === "";

  const onDownload = async () => {
    if (!validateBeforeAction()) return;
    if (profileMode && needsSave) {
      setError("Save your changes before downloading the resume.");
      return;
    }
    if (needsSave && !(await save())) return;
    try {
      const file = await download().unwrap();
      const link = document.createElement("a");
      link.href = file.url;
      link.download = file.filename;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(file.url), 10_000);
    } catch (failure) {
      showErrorFeedback(getApiErrorMessage(failure, "The resume could not be downloaded."));
    }
  };

  const onSubmit = async () => {
    if (!validateBeforeAction()) return;
    if (content && content.experience.length === 0 && content.education.length === 0 && content.skills.length === 0) {
      setMobileTab("edit");
      setError("Add experience, education, or at least one skill before submitting your resume.");
      return;
    }
    if (profileMode && onBeforeSubmit && !(await onBeforeSubmit())) return;
    if (needsSave && !(await save())) return;
    try {
      setFinalizing(true);
      await onSubmitted(await push().unwrap());
    } catch (failure) {
      const message = getApiErrorMessage(failure, profileMode ? "The score could not be updated. Your saved draft is still available." : "Your resume could not be submitted. Add your name and at least one job, qualification or skill.");
      setError(message);
      showErrorFeedback(message);
    } finally {
      setFinalizing(false);
    }
  };

  const onReset = async () => {
    try {
      const result = await resetDraft().unwrap();
      setResetOpen(false);
      setContent(result.content);
      setShowValidation(false);
      setError("");
      setTemplate(result.template_key);
      setSavedSnapshot(snapshot(result.content, result.template_key));
      setEditorKey((key) => key + 1);
      await draw(result.content, result.template_key);
    } catch (failure) {
      showErrorFeedback(getApiErrorMessage(failure, "The resume could not be reset."));
    }
  };

  // "Keep my draft" only dismisses the offer; the draft and the editor stay as they are.
  const onKeepDraft = async () => {
    try {
      await keepDraft().unwrap();
    } catch (failure) {
      showErrorFeedback(getApiErrorMessage(failure, "We couldn't keep your draft. Please try again."));
    }
  };

  const patch = (changes: Partial<StructuredResume>) => {
    setError("");
    setContent((current) => (current ? { ...current, ...changes } : current));
  };
  const contacts = useMemo(() => content?.contacts, [content]);
  const entryTemplateNeedsSave = profileMode && initialTemplate && draftQuery.data
    && initialTemplate !== draftQuery.data.template_key && entryTemplateSave !== "done";

  if (draftQuery.isError)
    return (
      <div className="mx-auto max-w-lg p-8 text-center" role="alert">
        <p className="text-[#3A4761]">We could not load your resume details.</p>
        <button type="button" className="mt-4 rounded-full bg-[#5F4DB2] px-5 py-2 font-semibold text-white" onClick={() => void draftQuery.refetch()}>Try again</button>
        <div className="mt-3"><button type="button" className="text-sm underline" onClick={onBack}>Back</button></div>
      </div>
    );

  if (entryTemplateNeedsSave) {
    return entryTemplateSave === "error" ? (
      <div className="mx-auto max-w-lg p-8 text-center" role="alert">
        <p className="text-sm text-red-700">{entryTemplateError}</p>
        <button type="button" onClick={() => void saveEntryTemplate(draftQuery.data.content, initialTemplate)} className="mt-4 rounded-full bg-[#5F4DB2] px-5 py-2 text-sm font-semibold text-white">Try again</button>
        <button type="button" onClick={onBack} className="ml-3 text-sm underline">Back to profile</button>
      </div>
    ) : <div className="grid min-h-[60dvh] place-items-center gap-2 text-sm text-[#5F4DB2]"><Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" /> Saving your template…</div>;
  }

  if (!content || !contacts)
    return <div className="grid min-h-[60dvh] place-items-center text-[#5F4DB2]"><Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" /></div>;

  return (
    <div className={`flex flex-col bg-[#FFFCF7] text-[#0A1931] ${profileMode ? "h-full" : "h-dvh"}`}>
      <header className="flex flex-wrap items-center gap-3 border-b border-[#F0EBDF] bg-white px-4 py-3">
        <button type="button" onClick={onBack} disabled={busy} className="flex items-center gap-2 rounded-full border border-[#DDD6C7] px-4 py-2 text-sm font-semibold disabled:opacity-50">
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-[16px] font-bold leading-5">{profileMode ? "Update your resume" : "Generate your resume"}</h1>
          <p className="text-[12px] text-[#5F6B80]">{needsSave ? "Unsaved changes. Save to keep this template and your edits." : "Saved. The preview matches your draft."}</p>
        </div>
        <button type="button" onClick={() => void onSave()} disabled={busy || !needsSave} className="flex items-center gap-2 rounded-full border border-[#5F4DB2] px-4 py-2 text-sm font-semibold text-[#5F4DB2] disabled:opacity-50">
          {saveState.isLoading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Save
        </button>
        <button type="button" onClick={() => void onDownload()} disabled={busy} className="flex items-center gap-2 rounded-full border border-[#DDD6C7] px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {downloadState.isLoading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />} Download
        </button>
        <button type="button" onClick={() => void onSubmit()} disabled={busy} className="flex items-center gap-2 rounded-full bg-[#5F4DB2] px-5 py-2 text-sm font-semibold text-white hover:bg-[#4A3E8F] disabled:opacity-60">
          {pushState.isLoading || finalizing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />} {profileMode ? profileSubmissionLabel ?? "Save & update score" : "Submit"}
        </button>
      </header>
      {profileMode && profileSubmissionNotice && (
        <div id="builder-score-availability" role="status" className="border-b border-[#E9D9A6] bg-[#FFFAE9] px-4 py-2 text-[12px] leading-5 text-[#6B4E0A]">
          {profileSubmissionNotice}
        </div>
      )}

      {draftQuery.data?.out_of_date && (
        <div role="alert" className="flex flex-wrap items-center gap-3 border-b border-[#E9D9A6] bg-[#FBF3D9] px-4 py-3">
          <div className="mr-auto min-w-0">
            <p className="text-[13px] font-bold text-[#6B4E0A]">A newer resume was uploaded</p>
            <p className="text-[12px] leading-5 text-[#85650F]">This draft was not filled from it. Refill replaces your draft with the new resume; keep my draft leaves your edits as they are.</p>
          </div>
          <button type="button" onClick={() => void onReset()} disabled={busy} className="flex items-center gap-2 rounded-full bg-[#5F4DB2] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#4A3E8F] disabled:opacity-60">
            {resetState.isLoading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Refill
          </button>
          <button type="button" onClick={() => void onKeepDraft()} disabled={busy} className="flex items-center gap-2 rounded-full border border-[#C9B46A] bg-white px-4 py-2 text-[13px] font-semibold text-[#6B4E0A] disabled:opacity-60">
            {keepState.isLoading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Keep my draft
          </button>
        </div>
      )}

      <div className="flex border-b border-[#F0EBDF] lg:hidden" role="tablist">
        {(["edit", "preview"] as const).map((tab) => (
          <button key={tab} type="button" role="tab" aria-selected={mobileTab === tab} onClick={() => setMobileTab(tab)}
            className={`flex-1 py-2.5 text-sm font-semibold capitalize ${mobileTab === tab ? "border-b-2 border-[#5F4DB2] text-[#5F4DB2]" : "text-[#5F6B80]"}`}>{tab}</button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        <div ref={editorScrollRef} className={`min-h-0 overflow-y-auto px-4 py-5 sm:px-6 ${mobileTab === "edit" ? "" : "hidden lg:block"}`}>
          <div key={editorKey} className="mx-auto flex max-w-xl flex-col gap-6">
            {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
            <p className="text-[13px] leading-5 text-[#3A4761]">
              {profileMode ? "The preview shows your current details and template. Save your changes before downloading." : "We filled this in from your onboarding answers. Correct anything, add your projects, then press Save to keep your changes."}
            </p>

            <Section title="Template" action={<button type="button" onClick={() => setResetOpen(true)} disabled={busy} className="flex items-center gap-1 text-xs text-[#5F6B80] underline disabled:opacity-50"><RotateCcw size={12} aria-hidden="true" /> Refill from my answers</button>}>
              {templates.isLoading && <p className="flex items-center gap-2 text-[12px] text-[#5F6B80]"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading templates…</p>}
              {templates.isError && <p role="alert" className="text-[12px] text-red-700">Templates could not be loaded. <button type="button" onClick={() => void templates.refetch()} className="underline">Try again</button></p>}
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Resume template">
                {(templates.data?.templates ?? []).map((item) => (
                  <button key={item.key} type="button" role="radio" aria-checked={selectedTemplate === item.key} disabled={busy} onClick={() => { if (item.key === selectedTemplate) return; setTemplate(item.key); void draw(content, item.key); }}
                    className={`rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ${selectedTemplate === item.key ? "border-[#5F4DB2] bg-[#F1EAF7]" : "border-[#DDD6C7] bg-white hover:border-[#5F4DB2]"}`}>
                    <span className="block text-sm font-semibold">{item.name}</span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-[#5F6B80]">{item.description}</span>
                  </button>
                ))}
              </div>
              <p className="text-[12px] leading-5 text-[#5F6B80]">Choose a template to preview it with your current details. Save to keep your choice.</p>
            </Section>

            <Section id="builder-section-about" title="About you">
              <Text label="Full name" value={content.full_name} onChange={(full_name) => patch({ full_name })} error={showValidation ? required(content.full_name, "your full name") : ""} />
              <Text label="Headline" value={content.headline} onChange={(headline) => patch({ headline })} placeholder="e.g. Data Analyst" />
              <Text label="City" value={content.location} onChange={(location) => patch({ location })} />
              <Text label="Summary" value={content.summary} onChange={(summary) => patch({ summary })} multiline placeholder="Two or three lines about your work." />
            </Section>

            <Section id="builder-section-contacts" title="Contact and links">
              <Text label="Email" value={contacts.email} onChange={(email) => patch({ contacts: { ...contacts, email } })} />
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-[12px] font-semibold text-[#3A4761]">Phone</span>
                <PhoneNumberInput
                  variant="student-compact"
                  value={contacts.phone}
                  onChange={(phone) => patch({ contacts: { ...contacts, phone } })}
                  ariaLabel="Phone"
                  inputClassName={input}
                />
              </div>
              <Text label="LinkedIn" value={contacts.linkedin} onChange={(linkedin) => patch({ contacts: { ...contacts, linkedin } })} />
              <Text label="GitHub" value={contacts.github} onChange={(github) => patch({ contacts: { ...contacts, github } })} />
              <Text label="Website" value={contacts.website} onChange={(website) => patch({ contacts: { ...contacts, website } })} />
            </Section>

            <Section id="builder-section-experience" title="Experience">
              <Repeater items={content.experience} blank={blank.experience} validate={validateExperience} showErrors={showValidation} onChange={(experience) => patch({ experience })} addLabel="Add experience" empty="Freshers can leave this empty."
                render={(item, set, errors) => (<>
                  <Row><Text label="Job title" value={item.job_title} onChange={(job_title) => set({ job_title })} error={errors.job_title} /><Text label="Company" value={item.company} onChange={(company) => set({ company })} error={errors.company} /></Row>
                  <Row><PartialDateField label="Start date" value={item.start_date} onChange={(start_date) => set({ start_date })} error={errors.start_date} />
                    <PartialDateField label="End date" value={item.is_current ? "" : item.end_date} disabled={item.is_current} onChange={(end_date) => set({ end_date })} error={errors.end_date} /></Row>
                  <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={item.is_current} onChange={(event) => set({ is_current: event.target.checked, end_date: event.target.checked ? "" : item.end_date })} /> I work here now</label>
                  <Text label="Location" value={item.location} onChange={(location) => set({ location })} />
                  <Text label="What you did" value={item.description} onChange={(description) => set({ description })} multiline />
                  <ListText label="Highlights (one per line)" value={item.highlights} onChange={(highlights) => set({ highlights })} lines />
                </>)} />
            </Section>

            <Section id="builder-section-education" title="Education">
              <Repeater items={content.education} blank={blank.education} validate={validateEducation} showErrors={showValidation} onChange={(education) => patch({ education })} addLabel="Add education"
                render={(item, set, errors) => (<>
                  <Row><Text label="Qualification" value={item.qualification} onChange={(qualification) => set({ qualification })} placeholder="B.Com" error={errors.qualification} /><Text label="Field of study" value={item.field_of_study} onChange={(field_of_study) => set({ field_of_study })} /></Row>
                  <Text label="Institution" value={item.institution} onChange={(institution) => set({ institution })} error={errors.institution} />
                  <Text label="Institution city" value={item.location} onChange={(location) => set({ location })} placeholder="e.g. Mumbai" />
                  <Row><PartialDateField label="Start year" value={item.start_date} onChange={(start_date) => set({ start_date })} yearOnly error={errors.start_date} /><PartialDateField label="End / expected year" value={item.end_date} onChange={(end_date) => set({ end_date })} yearOnly error={errors.end_date} /></Row>
                  <Text label="Grade" value={item.grade} onChange={(grade) => set({ grade })} placeholder="8.4 CGPA" />
                </>)} />
            </Section>

            <Section id="builder-section-skills" title="Skills">
              <BadgeListField label="Skills" singular="skill" value={content.skills} onChange={(skills) => patch({ skills })} maxItems={150} maxLength={300} />
            </Section>

            <Section id="builder-section-projects" title="Projects">
              <Repeater items={content.projects} blank={blank.project} validate={validateProject} showErrors={showValidation} onChange={(projects) => patch({ projects })} addLabel="Add a project" empty="Add projects to make your resume stronger."
                render={(item, set, errors) => (<>
                  <Row><Text label="Project name" value={item.name} onChange={(name) => set({ name })} error={errors.name} /><Text label="Your role" value={item.role} onChange={(role) => set({ role })} /></Row>
                  <Text label="Description" value={item.description} onChange={(description) => set({ description })} multiline placeholder="What it does and what you built." error={errors.description} />
                  <ListText label="Technologies (comma separated)" value={item.technologies} onChange={(technologies) => set({ technologies })} />
                  <Text label="Link" value={item.url} onChange={(url) => set({ url })} />
                  <Row><PartialDateField label="Start date" value={item.start_date} onChange={(start_date) => set({ start_date })} error={errors.start_date} /><PartialDateField label="End date" value={item.end_date} onChange={(end_date) => set({ end_date })} error={errors.end_date} /></Row>
                </>)} />
            </Section>

            <Section id="builder-section-certifications" title="Certifications">
              <Repeater items={content.certifications} blank={blank.certification} validate={validateCertification} showErrors={showValidation} onChange={(certifications) => patch({ certifications })} addLabel="Add certification"
                render={(item, set, errors) => (<>
                  <Row><Text label="Name" value={item.name} onChange={(name) => set({ name })} error={errors.name} /><Text label="Issued by" value={item.issuer} onChange={(issuer) => set({ issuer })} error={errors.issuer} /></Row>
                  <Row><PartialDateField label="Issue date" value={item.issue_date} onChange={(issue_date) => set({ issue_date })} error={errors.issue_date} /><PartialDateField label="Expiry date" value={item.expiry_date} onChange={(expiry_date) => set({ expiry_date })} error={errors.expiry_date} /></Row>
                </>)} />
            </Section>

            <Section id="builder-section-languages" title="Languages">
              <Repeater items={content.languages} blank={blank.language} validate={validateLanguage} showErrors={showValidation} onChange={(languages) => patch({ languages })} addLabel="Add language"
                render={(item, set, errors) => (
                  <Row><Text label="Language" value={item.name} onChange={(name) => set({ name })} error={errors.name} /><ProficiencyField value={item.proficiency} onChange={(proficiency) => set({ proficiency })} error={errors.proficiency} /></Row>
                )} />
            </Section>

            <Section id="builder-section-achievements-and-interests" title="Achievements and interests">
              <BadgeListField label="Achievements" singular="achievement" value={content.achievements} onChange={(achievements) => patch({ achievements })} maxItems={60} maxLength={5000} />
              <BadgeListField label="Interests" singular="interest" value={content.interests} onChange={(interests) => patch({ interests })} maxItems={40} maxLength={300} />
            </Section>
            <Section id="builder-section-other-sections" title="Other sections">
              <Repeater items={content.other_sections} blank={blank.otherSection} validate={validateOtherSection} showErrors={showValidation} onChange={(other_sections) => patch({ other_sections })} addLabel="Add other section" empty="Add an extra section for details that do not fit elsewhere."
                render={(item, set, errors) => <><Text label="Section heading" value={item.heading} onChange={(heading) => set({ heading })} error={errors.heading} /><ListText label="Items (one per line)" value={item.items} onChange={(items) => set({ items })} lines /></>} />
            </Section>
          </div>
        </div>

        <div className={`min-h-0 overflow-y-auto border-l border-[#F0EBDF] bg-[#EFEBE0] p-4 sm:p-6 ${mobileTab === "preview" ? "" : "hidden lg:block"}`} aria-label="Resume preview">
          <div className="mx-auto flex max-w-[640px] flex-col gap-4">
            {pages?.pages.map((page, index) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={index} src={`data:${pages.mime};base64,${page}`} alt={`Resume page ${index + 1}`} className="w-full rounded-sm bg-white shadow-md" />
            ))}
            {!pages && <p className="py-20 text-center text-sm text-[#5F6B80]">Drawing your resume…</p>}
            {previewState.isLoading && <p className="text-center text-xs text-[#5F6B80]"><Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden="true" />Updating preview…</p>}
          </div>
        </div>
      </div>
      <ConfirmModal
        open={resetOpen}
        variant="student"
        icon={<RotateCcw size={18} aria-hidden="true" />}
        title="Refill from your answers?"
        description="Your resume will be refilled from your onboarding answers. Your edits will be replaced."
        confirmLabel="Refill resume"
        cancelLabel="Keep edits"
        confirmLoading={resetState.isLoading}
        onClose={() => setResetOpen(false)}
        onConfirm={() => void onReset()}
      />
    </div>
  );
}

function Section({ id, title, action, children }: { id?: string; title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-3 scroll-mt-4 rounded-2xl border border-[#E7E0D4] bg-white p-4">
      <div className="flex items-center justify-between gap-3"><h2 className="text-[15px] font-bold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div className="grid gap-3 sm:grid-cols-2">{children}</div>;

function Text({ label, value, onChange, multiline, placeholder, disabled, error }: {
  label: string; value: string; onChange: (value: string) => void; multiline?: boolean; placeholder?: string; disabled?: boolean; error?: string;
}) {
  const errorId = useId();
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-semibold text-[#3A4761]">{label}</span>
      {multiline
        ? <textarea className={`${input} min-h-20 resize-y ${error ? "border-red-500" : ""}`} value={value} placeholder={placeholder} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} data-resume-invalid={error ? "true" : undefined} onChange={(event) => onChange(event.target.value)} />
        : <input className={`${input} disabled:bg-[#F7F4EC] ${error ? "border-red-500" : ""}`} value={value} disabled={disabled} placeholder={placeholder} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} data-resume-invalid={error ? "true" : undefined} onChange={(event) => onChange(event.target.value)} />}
      {error && <span id={errorId} className="text-xs text-red-700">{error}</span>}
    </label>
  );
}

const currentYear = new Date().getFullYear();
const years = Array.from({ length: currentYear - 1899 }, (_, index) => {
  const year = String(currentYear - index);
  return { value: year, label: year };
});
const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
].map((label, index) => ({ value: String(index + 1).padStart(2, "0"), label }));
const selectClass = "[&>button]:h-[42px] [&>button]:text-[13px] [&>button>span]:font-medium";

function PartialDateField({ label, value, onChange, yearOnly = false, disabled = false, error }: {
  label: string; value: string; onChange: (value: string) => void; yearOnly?: boolean; disabled?: boolean; error?: string;
}) {
  const year = /^\d{4}/.exec(value)?.[0] ?? "";
  const month = /-(\d{2})$/.exec(value)?.[1] ?? "";
  const yearOptions = Number(year) > currentYear
    ? [{ value: year, label: `${year} (saved)` }, ...years]
    : years;
  const errorId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1" role="group" aria-label={label} aria-describedby={error ? errorId : undefined} data-resume-invalid={error ? "true" : undefined}>
      <span className="text-[12px] font-semibold text-[#3A4761]">{label}</span>
      <div className={`grid gap-2 ${yearOnly ? "" : "grid-cols-2"}`}>
        <AppSelect value={year} onChange={(next) => onChange(next ? `${next}${!yearOnly && month ? `-${month}` : ""}` : !yearOnly && month ? `-${month}` : "")}
          options={[{ value: "", label: "Year" }, ...yearOptions]} placeholder="Year" ariaLabel={`${label} year`} searchable searchPlaceholder="Search year"
          disabled={disabled} variant="student-compact" menuPlacement="auto" portal className={selectClass} />
        {!yearOnly && <AppSelect value={month} onChange={(next) => onChange(next ? `${year}-${next}` : year)}
          options={[{ value: "", label: "Month" }, ...months]} placeholder="Month" ariaLabel={`${label} month`}
          disabled={disabled} variant="student-compact" menuPlacement="auto" portal className={selectClass} />}
      </div>
      {error && <span id={errorId} className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

function ProficiencyField({ value, onChange, error }: { value: string; onChange: (value: string) => void; error?: string }) {
  const errorId = useId();
  return (
    <div className="flex min-w-0 flex-col gap-1" role="group" aria-label="Proficiency" aria-describedby={error ? errorId : undefined} data-resume-invalid={error ? "true" : undefined}>
      <span className="text-[12px] font-semibold text-[#3A4761]">Proficiency</span>
      <AppSelect value={value} onChange={onChange} options={languageProficiencyOptions(value)}
        ariaLabel="Proficiency" placeholder="Select proficiency" variant="student-compact" menuPlacement="auto" portal className={selectClass} />
      {error && <span id={errorId} className="text-xs text-red-700">{error}</span>}
    </div>
  );
}

function BadgeListField({ label, singular, value, onChange, maxItems, maxLength }: {
  label: string; singular: string; value: string[]; onChange: (value: string[]) => void; maxItems: number; maxLength: number;
}) {
  const inputId = useId();
  const messageId = useId();
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");

  const add = () => {
    const parts = draft.split(singular === "achievement" ? /\r?\n/ : /[,\r\n]+/).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...value];
    for (const part of parts) {
      if (part.length > maxLength) {
        setMessage(`Keep each ${singular} under ${maxLength} characters.`);
        return;
      }
      if (next.some((existing) => existing.toLocaleLowerCase() === part.toLocaleLowerCase())) continue;
      if (next.length >= maxItems) {
        setMessage(`You can add up to ${maxItems} ${label.toLowerCase()}.`);
        return;
      }
      next.push(part);
    }
    if (next.length !== value.length) onChange(next);
    setDraft("");
    setMessage("");
  };

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-[12px] font-semibold text-[#3A4761]">{label}</label>
      <input id={inputId} className={input} value={draft} maxLength={maxLength} placeholder={`Type a ${singular} and press Enter`}
        aria-describedby={message ? messageId : undefined} aria-invalid={Boolean(message)}
        onChange={(event) => { setDraft(event.target.value); setMessage(""); }}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add(); } }}
        onBlur={add} />
      {message && <p id={messageId} role="alert" className="text-xs text-red-700">{message}</p>}
      {value.length > 0 && <ul className="flex flex-wrap gap-2" aria-label={`Added ${label.toLowerCase()}`}>
        {value.map((item, index) => (
          <li key={`${item}-${index}`} className="flex max-w-full items-center gap-1.5 rounded-full border border-[#D6C9F0] bg-[#F1EAF7] py-1 pl-3 pr-1.5 text-xs font-medium text-[#4A3E8F]">
            <span className="min-w-0 break-words">{item}</span>
            <button type="button" aria-label={`Remove ${singular}: ${item}`} onClick={() => onChange(value.filter((_, position) => position !== index))}
              className="grid h-5 w-5 shrink-0 place-items-center rounded-full hover:bg-[#E2D6F5] focus-visible:outline-2 focus-visible:outline-[#5F4DB2]">
              <X size={12} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>}
    </div>
  );
}

/** A list typed as one text box; the raw text is kept so a trailing comma is not eaten. */
function ListText({ label, value, onChange, lines }: { label: string; value: string[]; onChange: (value: string[]) => void; lines?: boolean }) {
  const separator = lines ? /\n/ : /,|\n/;
  const [text, setText] = useState(value.join(lines ? "\n" : ", "));
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[12px] font-semibold text-[#3A4761]">{label}</span>
      <textarea className={`${input} min-h-16 resize-y`} value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(event.target.value.split(separator).map((item) => item.trim()).filter(Boolean));
        }} />
    </label>
  );
}

function Repeater<T>({ items, blank: makeBlank, onChange, render, validate, showErrors, addLabel, empty }: {
  items: T[]; blank: () => T; onChange: (items: T[]) => void; addLabel: string; empty?: string;
  validate: (item: T) => RowErrors; showErrors: boolean;
  render: (item: T, set: (changes: Partial<T>) => void, errors: RowErrors) => ReactNode;
}) {
  const [keys, setKeys] = useState(() => items.map((_, index) => index));
  const counter = useRef(items.length);
  const [attempted, setAttempted] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  const add = () => {
    if (items.some((item) => rowHasErrors(validate(item)))) {
      setAttempted(true);
      requestAnimationFrame(() => {
        const first = groupRef.current?.querySelector<HTMLElement>('[data-resume-invalid="true"]');
        (first?.matches("input, textarea, button") ? first : first?.querySelector<HTMLElement>("input, textarea, button"))?.focus();
      });
      return;
    }
    setAttempted(false);
    const nextKey = counter.current++;
    setKeys((current) => [...current, nextKey]);
    onChange([...items, makeBlank()]);
  };
  return (
    <div ref={groupRef} className="flex flex-col gap-3">
      {items.length === 0 && empty && <p className="text-[13px] text-[#5F6B80]">{empty}</p>}
      {items.map((item, index) => (
        <div key={keys[index] ?? index} className="flex flex-col gap-3 rounded-xl border border-[#EFE9DB] bg-[#FFFCF7] p-3">
          {render(item, (changes) => onChange(items.map((current, position) => (position === index ? { ...current, ...changes } : current))), attempted || showErrors ? validate(item) : {})}
          <button type="button" onClick={() => { setKeys((current) => current.filter((_, position) => position !== index)); onChange(items.filter((_, position) => position !== index)); }}
            className="flex items-center gap-1 self-end text-xs text-[#9A3B42] underline"><Trash2 size={12} aria-hidden="true" /> Remove</button>
        </div>
      ))}
      <button type="button" onClick={add}
        className="flex items-center gap-2 self-start rounded-full border border-dashed border-[#5F4DB2] px-4 py-2 text-sm font-semibold text-[#5F4DB2]"><Plus size={14} aria-hidden="true" /> {addLabel}</button>
    </div>
  );
}
