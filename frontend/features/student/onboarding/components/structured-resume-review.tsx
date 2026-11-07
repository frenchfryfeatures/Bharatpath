"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { Award, BriefcaseBusiness, Check, ContactRound, FolderKanban, GraduationCap, Heart, Languages, List, PencilLine, Plus, Trash2, Trophy, UserRound, Wrench, X, type LucideIcon } from "lucide-react";
import { StructuredResumeSectionView, resumeLabel, type StructuredResume } from "@/components/resume/structured-resume";
import { languageProficiencyOptions } from "@/components/resume/language-proficiency";
import { PartialDateSelect } from "@/components/resume/partial-date-select";
import { structuredResumeToText } from "@/components/resume/structured-resume-text";
import { AppSelect } from "@/components/ui/app-select";
import { getApiErrorCode, getApiErrorMessage, getApiErrorParams } from "@/lib/api/error-message";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { PhoneNumberInput } from "@/components/ui/phone-number-input";
import { useConfirmResumeVersionMutation, useEditResumeVersionMutation, useSubmitResumeTextMutation, type ResumeScoringWindow, type ResumeVersionDetail } from "@/store/student";
import { Card, DoneDot, ErrorNote, fieldBorder, fieldClass, PillButton } from "./ui";
import { validateReviewedResume, type ReviewIssue, type ReviewPath } from "./resume-review-validation";

type Path = ReviewPath;
type SectionKey = keyof StructuredResume | "basics";
const sections: Array<{ key: SectionKey; label: string; icon: LucideIcon }> = [
  { key: "basics", label: "Basics and summary", icon: UserRound },
  { key: "contacts", label: "Contact and links", icon: ContactRound },
  { key: "experience", label: "Experience", icon: BriefcaseBusiness },
  { key: "education", label: "Education", icon: GraduationCap },
  { key: "skills", label: "Skills", icon: Wrench },
  { key: "projects", label: "Projects", icon: FolderKanban },
  { key: "certifications", label: "Certifications", icon: Award },
  { key: "languages", label: "Languages", icon: Languages },
  { key: "achievements", label: "Achievements", icon: Trophy },
  { key: "interests", label: "Interests", icon: Heart },
  { key: "other_sections", label: "Other sections", icon: List },
];
const blankItems: Record<string, unknown> = {
  others: { label: "", url: "" },
  experience: { job_title: "", company: "", location: "", employment_type: "", start_date: "", end_date: "", is_current: false, description: "", highlights: [], skills_used: [] },
  education: { qualification: "", field_of_study: "", institution: "", location: "", start_date: "", end_date: "", grade: "", description: "" },
  projects: { name: "", role: "", description: "", technologies: [], url: "", start_date: "", end_date: "" },
  certifications: { name: "", issuer: "", issue_date: "", expiry_date: "", credential_id: "", url: "" },
  languages: { name: "", proficiency: "" },
  other_sections: { heading: "", items: [] },
};
const multiline = new Set(["summary", "description"]);
const longListItem = new Set(["highlight", "achievement", "item"]);
const chipLists = new Set(["skills", "skills_used", "technologies", "interests"]);
const urlFields = new Set(["url", "website", "linkedin", "github", "behance", "instagram", "tiktok", "pinterest", "x_twitter", "medium", "dev_to", "stack_overflow"]);
const desktopFieldClass = "lg:rounded-[12px] lg:px-3.5 lg:py-2.5 lg:text-[14px] lg:leading-5";
const contactGroups = [
  { title: "Contact details", fields: ["email", "phone", "website"] },
  { title: "Professional profiles", fields: ["linkedin", "github", "behance", "dev_to", "stack_overflow", "medium"] },
  { title: "Social profiles", fields: ["instagram", "tiktok", "pinterest", "x_twitter"] },
] as const;
const wideSections = new Set<SectionKey>(["basics", "contacts", "experience", "education", "skills", "projects", "other_sections"]);
const builderSectionByReviewSection: Record<SectionKey, string> = {
  basics: "about",
  full_name: "about",
  headline: "about",
  location: "about",
  summary: "about",
  contacts: "contacts",
  experience: "experience",
  education: "education",
  skills: "skills",
  projects: "projects",
  certifications: "certifications",
  languages: "languages",
  achievements: "achievements-and-interests",
  interests: "achievements-and-interests",
  other_sections: "other-sections",
};

function formatScoringTimeInIst(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  }).format(date)} IST`;
}

function scoringAvailabilityLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return formatScoringTimeInIst(value);
  const days = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 86_400_000));
  const relative = days === 0 ? "today" : `in ${days} ${days === 1 ? "day" : "days"}`;
  return `${formatScoringTimeInIst(value)} (${relative})`;
}

function setPath(doc: StructuredResume, path: Path, value: unknown): StructuredResume {
  const copy = structuredClone(doc);
  let target: Record<string | number, unknown> = copy as unknown as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) target = target[key] as Record<string | number, unknown>;
  target[path[path.length - 1]] = value;
  return copy;
}

function hasContent(resume: StructuredResume, section: SectionKey): boolean {
  if (section === "basics") return [resume.full_name, resume.headline, resume.location, resume.summary].some(Boolean);
  if (section === "contacts") return Object.values(resume.contacts).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value));
  return resume[section].length > 0;
}

function sectionForPath(path: Path): SectionKey {
  return ["full_name", "headline", "location", "summary"].includes(String(path[0])) ? "basics" : path[0] as SectionKey;
}

function focusFirstInvalid(panel: HTMLElement | null) {
  requestAnimationFrame(() => {
    const invalid = panel?.querySelector<HTMLElement>('[data-resume-invalid="true"]');
    if (!invalid) return;
    invalid.scrollIntoView({ behavior: "smooth", block: "center" });
    invalid.querySelector<HTMLElement>('input, textarea, [role="combobox"], button')?.focus({ preventScroll: true });
  });
}

function InputTree({ name, value, path, onChange, issues }: {
  name: string; value: unknown; path: Path; onChange: (path: Path, value: unknown) => void; issues: ReviewIssue[];
}) {
  const [newItem, setNewItem] = useState("");
  const errorId = useId();
  const issue = issues.find((item) => JSON.stringify(item.path) === JSON.stringify(path));
  const invalid = issue ? "true" : undefined;
  const message = issue && <span id={errorId} role="alert" className="block text-[12px] font-medium text-[#A13D37]">{issue.message}</span>;
  if (Array.isArray(value) && chipLists.has(name)) {
    const addItem = () => {
      const item = newItem.trim();
      if (!item || value.some((existing) => String(existing).toLowerCase() === item.toLowerCase())) return;
      onChange(path, [...value, item]);
      setNewItem("");
    };
    return <div className="space-y-3 lg:space-y-2.5" data-resume-invalid={invalid}>
      <label className="block text-[13px] font-semibold text-[#0A1931] lg:text-[12px]">{resumeLabel(name)}</label>
      <div className="flex gap-2">
        <input value={newItem} maxLength={300} placeholder={`Add ${resumeLabel(name).toLowerCase()}...`} onChange={(event) => setNewItem(event.target.value)} onBlur={addItem} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addItem(); } }} className={`${fieldClass} ${fieldBorder(false)} ${desktopFieldClass} min-w-0 flex-1`} />
        <button type="button" onClick={addItem} disabled={!newItem.trim()} className="inline-flex cursor-pointer items-center gap-1.5 rounded-[16px] bg-[#5F4DB2] px-4 text-[13px] font-semibold text-white transition hover:bg-[#4A3E8F] disabled:cursor-not-allowed disabled:opacity-45 lg:px-3.5 lg:text-[12px]"><Plus size={15} aria-hidden="true" /> Add</button>
      </div>
      <div className="flex flex-wrap gap-2">{value.map((item, index) => <span key={`${item}-${index}`} className="inline-flex items-center gap-2 rounded-full bg-[#F7EFD6] py-2 pl-3.5 pr-2 text-[13px] font-medium text-[#0A1931]" data-resume-invalid={issues.some((entry) => JSON.stringify(entry.path) === JSON.stringify([...path, index])) ? "true" : undefined}>{String(item)}<button type="button" onClick={() => onChange(path, value.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${item || "empty entry"}`} className="grid h-5 w-5 cursor-pointer place-items-center rounded-full text-[#667085] transition hover:bg-[#EADFBF] hover:text-[#0A1931]"><X size={13} aria-hidden="true" /></button></span>)}</div>
      {issues.filter((entry) => entry.path.length === path.length + 1 && JSON.stringify(entry.path.slice(0, -1)) === JSON.stringify(path)).map((entry) => <span key={JSON.stringify(entry.path)} role="alert" className="block text-[12px] text-[#A13D37]">{entry.message}</span>)}
      {message}
    </div>;
  }
  if (Array.isArray(value)) return (
    <div className="space-y-3 lg:space-y-2.5" data-resume-invalid={invalid}>
      <h4 className="text-[13px] font-semibold text-[#0A1931] lg:text-[12px]">{resumeLabel(name)}</h4>
      {value.map((item, index) => (
        <div key={index} className="rounded-[16px] border border-[#E7E0D4] bg-[#F7F4EC] p-4 lg:rounded-[14px] lg:p-3">
          <div className="mb-3 flex items-center justify-between gap-3 lg:mb-2">
            <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#5F6B80] lg:text-[10px]">{name === "others" ? "Link" : resumeLabel(name)} {index + 1}</span>
            <button type="button" onClick={() => onChange(path, value.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${name === "others" ? "link" : resumeLabel(name)} ${index + 1}`} className="inline-flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-semibold text-[#A13D37] transition hover:bg-[#F8E6E0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A13D37]/30 lg:text-[11px]"><Trash2 size={13} aria-hidden="true" /> Remove</button>
          </div>
          {name === "others" && item !== null && typeof item === "object" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(item).map(([key, field]) => <InputTree key={key} name={key} value={field} path={[...path, index, key]} onChange={onChange} issues={issues} />)}
            </div>
          ) : <InputTree name={name.endsWith("s") ? name.slice(0, -1) : name} value={item} path={[...path, index]} onChange={onChange} issues={issues} />}
        </div>
      ))}
      <button type="button" onClick={() => onChange(path, [...value, structuredClone(blankItems[name] ?? "")])} className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-[16px] border border-dashed border-[#CFC4F4] bg-white px-4 py-3 text-[13px] font-semibold text-[#5F4DB2] transition hover:border-[#5F4DB2] hover:bg-[#FCFAFF] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30 lg:rounded-[12px] lg:py-2 lg:text-[12px]"><Plus size={15} aria-hidden="true" /> Add {name === "others" ? "another link" : resumeLabel(name).toLowerCase()}</button>
      {message}
    </div>
  );
  if (value !== null && typeof value === "object") return (
    <div className="grid gap-4 lg:gap-3">
      {Object.entries(value).map(([key, item]) => <InputTree key={key} name={key} value={item} path={[...path, key]} onChange={onChange} issues={issues} />)}
    </div>
  );
  if (typeof value === "boolean") return <label className="flex cursor-pointer items-center gap-3 rounded-[16px] border border-[#E7E0D4] bg-white px-4 py-3.5 text-[14px] font-medium text-[#0A1931] lg:px-3.5 lg:py-2.5 lg:text-[13px]"><input type="checkbox" checked={value} onChange={(event) => onChange(path, event.target.checked)} className="h-4 w-4 accent-[#5F4DB2]" />{resumeLabel(name)}</label>;
  if (name === "phone") return (
    <div className="flex min-w-0 flex-col gap-1.5 text-[13px] font-semibold text-[#0A1931] lg:gap-1 lg:text-[12px]" data-resume-invalid={invalid}>
      <span>{resumeLabel(name)}</span>
      <PhoneNumberInput
        variant="student"
        value={String(value ?? "")}
        onChange={(next) => onChange(path, next)}
        ariaLabel="Phone"
        ariaInvalid={Boolean(issue)}
        ariaDescribedBy={issue ? errorId : undefined}
        inputClassName={`${fieldClass} ${fieldBorder(false)} ${desktopFieldClass}`}
      />
      {message}
    </div>
  );
  if (name === "proficiency" && path[0] === "languages") return (
    <div className="flex min-w-0 flex-col gap-1.5 text-[13px] font-semibold text-[#0A1931] lg:gap-1 lg:text-[12px]" data-resume-invalid={invalid}>
      <span>Proficiency</span>
      <AppSelect
        value={String(value ?? "")}
        onChange={(next) => onChange(path, next)}
        options={languageProficiencyOptions(String(value ?? ""))}
        ariaLabel="Proficiency"
        placeholder="Select proficiency"
        variant="student"
        menuPlacement="auto"
        portal
        ariaInvalid={Boolean(issue)}
        ariaDescribedBy={issue ? errorId : undefined}
        className="[&>button]:h-[52px] [&>button]:rounded-[16px] [&>button]:px-4 lg:[&>button]:h-[42px] lg:[&>button]:rounded-[12px] lg:[&>button]:px-3.5 lg:[&>button>span]:text-[14px]"
      />
      {message}
    </div>
  );
  if (name.endsWith("_date")) return (
    <div className="flex min-w-0 flex-col gap-1.5 text-[13px] font-semibold text-[#0A1931] lg:gap-1 lg:text-[12px]" data-resume-invalid={invalid}>
      <span>{resumeLabel(name)}</span>
      <PartialDateSelect
        label={resumeLabel(name)}
        value={String(value ?? "")}
        onChange={(next) => onChange(path, next)}
        invalid={Boolean(issue)}
        describedBy={issue ? errorId : undefined}
      />
      {message}
    </div>
  );
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-[13px] font-semibold text-[#0A1931] lg:gap-1 lg:text-[12px]" data-resume-invalid={invalid}>
      {resumeLabel(name)}
      {multiline.has(name) || longListItem.has(name) ? <textarea rows={longListItem.has(name) ? 2 : 4} value={String(value ?? "")} maxLength={5000} aria-invalid={Boolean(issue)} aria-describedby={issue ? errorId : undefined} onChange={(event) => onChange(path, event.target.value)} className={`${fieldClass} ${fieldBorder(false)} ${desktopFieldClass} min-h-20 resize-y font-normal lg:min-h-16`} /> : <input type={name === "email" ? "email" : "text"} value={String(value ?? "")} maxLength={urlFields.has(name) ? 500 : 300} aria-invalid={Boolean(issue)} aria-describedby={issue ? errorId : undefined} onChange={(event) => onChange(path, event.target.value)} className={`${fieldClass} ${fieldBorder(false)} ${desktopFieldClass}`} />}
      {message}
    </label>
  );
}

export function StructuredResumeReview({ version, onConfirmed, onStartOver, title, subtitle, confirmLabel, startOverLabel, restoreFromHistory = false, scoringWindow, scoringWindowKnown, scoringWindowError, onRefreshScoringWindow }: {
  version: ResumeVersionDetail; onConfirmed: (confirmedAt: string) => void; onStartOver: () => void;
  title: string; subtitle: string; confirmLabel: string; startOverLabel: string; restoreFromHistory?: boolean;
  scoringWindow?: ResumeScoringWindow; scoringWindowKnown: boolean; scoringWindowError: boolean; onRefreshScoringWindow: () => void;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<StructuredResume>(() => structuredClone(version.structuredResume!));
  const [editing, setEditing] = useState<SectionKey | null>(null);
  const [drawerDraft, setDrawerDraft] = useState<StructuredResume | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooldownNextScoringAt, setCooldownNextScoringAt] = useState<string | null>(null);
  const [savedWithoutScoring, setSavedWithoutScoring] = useState(false);
  const [editVersion, editState] = useEditResumeVersionMutation();
  const [submitResumeText, submitTextState] = useSubmitResumeTextMutation();
  const [confirmVersion, confirmState] = useConfirmResumeVersionMutation();
  const drawerRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const drawerTriggerRef = useRef<HTMLElement | null>(null);
  const drawerTitleId = useId();
  const busy = editState.isLoading || submitTextState.isLoading || confirmState.isLoading;
  const savingResume = editState.isLoading || submitTextState.isLoading;
  const [saved, setSaved] = useState(false);
  const isBuilderResume = version.source === "BUILDER";
  const scoringEligibilityPending = !scoringWindowKnown;
  const scoringIsUnlimited = scoringWindow?.intervalDays === 0;
  const scoringCooldownActive = !scoringEligibilityPending && !scoringIsUnlimited && (cooldownNextScoringAt !== null || scoringWindow?.canConfirmNow === false);
  const scoreUpdateUnavailable = scoringEligibilityPending || scoringCooldownActive;
  const nextScoringAt = cooldownNextScoringAt ?? scoringWindow?.nextScoringAt ?? null;
  const canConfirm = !saved && !scoreUpdateUnavailable && (restoreFromHistory || dirty || Boolean(createdId) || !version.confirmed);
  const hasPendingSave = dirty || (restoreFromHistory && !createdId);
  const selectedSection = sections.find((section) => section.key === editing);
  const DrawerIcon = selectedSection?.icon ?? PencilLine;
  const draftIssues = validateReviewedResume(draft);
  const drawerIssues = showValidation && drawerDraft && editing
    ? validateReviewedResume(drawerDraft).filter((issue) => sectionForPath(issue.path) === editing)
    : [];
  useScrollLock(editing !== null);

  useEffect(() => {
    if (editing === null) return;
    const panel = drawerRef.current;
    const firstField = panel?.querySelector<HTMLElement>("input, textarea");
    (firstField ?? panel)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (event.target instanceof Element && event.target.closest('[role="listbox"], [role="combobox"][aria-expanded="true"]')) return;
        setEditing(null);
        setDrawerDraft(null);
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable[focusable.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      drawerTriggerRef.current?.focus();
    };
  }, [editing]);

  useEffect(() => {
    if (editing && showValidation) focusFirstInvalid(drawerRef.current);
  }, [editing, showValidation]);

  useEffect(() => {
    if (error && !editing) errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error, editing]);

  const openDrawer = (section: SectionKey, validate = false) => {
    if (isBuilderResume) return;
    drawerTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDrawerDraft(structuredClone(draft));
    setShowValidation(validate);
    setEditing(section);
  };
  const editSection = (section: SectionKey) => {
    if (isBuilderResume) {
      router.push(`/student/profile/resume/edit?from=resume-details&section=${encodeURIComponent(builderSectionByReviewSection[section])}`);
      return;
    }
    openDrawer(section);
  };
  const closeDrawer = () => { setEditing(null); setDrawerDraft(null); setShowValidation(false); };
  const changeDrawer = (path: Path, value: unknown) => setDrawerDraft((current) => current ? setPath(current, path, value) : current);
  const applyDrawer = () => {
    if (!drawerDraft || !editing) return;
    const issues = validateReviewedResume(drawerDraft).filter((issue) => sectionForPath(issue.path) === editing);
    if (issues.length) {
      setShowValidation(true);
      focusFirstInvalid(drawerRef.current);
      return;
    }
    if (JSON.stringify(drawerDraft) !== JSON.stringify(draft)) {
      setDraft(drawerDraft);
      setDirty(true);
      setSaved(false);
      setError(null);
      setSavedWithoutScoring(false);
    }
    closeDrawer();
  };
  const saveChanges = async (reportSaveOnly = false): Promise<string | null> => {
    setError(null);
    const firstIssue = draftIssues[0];
    if (firstIssue) {
      setError("Complete or remove the highlighted entries before saving.");
      openDrawer(sectionForPath(firstIssue.path), true);
      return null;
    }
    try {
      let target = createdId ?? version.resumeVersionId;
      let savedNewVersion = false;
      if (restoreFromHistory && !createdId) {
        const text = structuredResumeToText(draft);
        if (text.length < 50) { setError("Add at least 50 characters of resume details before saving."); return null; }
        const created = version.source === "BUILDER"
          ? await submitResumeText(text).unwrap()
          : await editVersion({ resumeVersionId: version.resumeVersionId, edit: { text }, __suppressSuccessFeedback: true }).unwrap();
        target = created.resumeVersionId;
        setCreatedId(target);
        setDirty(false);
        savedNewVersion = true;
      } else if (dirty) {
        const text = structuredResumeToText(draft);
        if (text.length < 50) { setError("Add at least 50 characters of resume details before saving."); return null; }
        const created = await editVersion({ resumeVersionId: target, edit: { text }, __suppressSuccessFeedback: true }).unwrap();
        target = created.resumeVersionId;
        setCreatedId(target);
        setDirty(false);
        savedNewVersion = true;
      }
      if (reportSaveOnly && savedNewVersion) setSavedWithoutScoring(true);
      return target;
    } catch (failure) {
      setError(getApiErrorCode(failure) === "resume_version_superseded" ? "This resume changed in another tab. Reload the latest version." : getApiErrorMessage(failure, "The resume could not be saved. Please try again."));
      return null;
    }
  };
  const confirm = async () => {
    const target = await saveChanges();
    if (!target) return;
    if (!version.confirmed || restoreFromHistory || dirty || createdId) {
      try {
        const confirmed = await confirmVersion(target).unwrap();
        setSaved(true);
        onConfirmed(confirmed.confirmedAt);
      } catch (failure) {
        if (getApiErrorCode(failure) === "resume_scoring_cooldown") {
          const next = getApiErrorParams(failure)?.next_scoring_at;
          // Disable immediately, even if a malformed response omits the date;
          // the follow-up window request supplies the authoritative value.
          setCooldownNextScoringAt(typeof next === "string" ? next : "");
          setSavedWithoutScoring(true);
          setError(null);
        } else {
          setError(getApiErrorCode(failure) === "resume_version_superseded" ? "This resume changed in another tab. Reload the latest version." : getApiErrorMessage(failure, "The resume could not be saved. Please try again."));
        }
      } finally {
        // Eligibility is server-owned. Refresh it after every confirm attempt;
        // a cooldown refusal is displayed and never automatically retried.
        onRefreshScoringWindow();
      }
    }
  };
  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[24px] font-bold leading-8 tracking-[-0.02em] text-[#0A1931] lg:text-[22px] lg:leading-7">{title}</h1>
          {dirty && <span className="rounded-full bg-[#F7EFD6] px-3 py-1 text-[11px] font-bold text-[#85650F]">Unsaved changes</span>}
        </div>
        <p className="text-[14px] leading-5 text-[#3A4761] lg:text-[13px]">{subtitle}</p>
      </header>
      {error && <div ref={errorRef}><ErrorNote>{error}</ErrorNote></div>}
      <div className="grid gap-3 xl:grid-cols-2">
        {sections.map(({ key, label, icon: Icon }) => {
          return (
            <Card key={key} className={`min-w-0 p-4 ${wideSections.has(key) ? "xl:col-span-2" : ""}`}>
              <div className="flex items-center gap-3">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-[#F1EAF7] text-[#5F4DB2]"><Icon size={18} aria-hidden="true" /></span>
                <h2 className="min-w-0 flex-1 text-[15px] font-semibold leading-5 text-[#0A1931]">{label}</h2>
                {draftIssues.some((issue) => sectionForPath(issue.path) === key)
                  ? <span className="text-[11px] font-semibold text-[#A13D37]">Needs details</span>
                  : hasContent(draft, key) && <DoneDot />}
                <button
                  type="button"
                  onClick={() => editSection(key)}
                  aria-label={isBuilderResume ? `Edit ${label} in resume builder` : `Edit ${label}`}
                  aria-haspopup={isBuilderResume ? undefined : "dialog"}
                  className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-xl border border-[#E7E0D4] text-[#5F4DB2] transition hover:bg-[#F1EAF7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30"
                >
                  <PencilLine size={17} aria-hidden="true" />
                </button>
              </div>
              <div className="mt-4"><StructuredResumeSectionView resume={draft} section={key} /></div>
            </Card>
          );
        })}
      </div>
      <div className="sticky bottom-0 -mx-1 flex flex-col gap-3 border-t border-[#E7E0D4] bg-[#FFFCF7]/95 px-1 pb-3.5 pt-4 backdrop-blur">
        <PillButton onClick={() => void confirm()} isLoading={confirmState.isLoading} disabled={busy || !canConfirm} className="w-full py-[18px] lg:py-3 lg:text-[14px]">
          {scoringEligibilityPending ? "Checking score availability" : scoringCooldownActive ? "Score update unavailable" : canConfirm ? confirmLabel : "Already confirmed"}
        </PillButton>
        {scoreUpdateUnavailable && (
          <div role="status" className="space-y-1 text-center text-[12px] leading-4 text-[#5F6B80]">
            {scoringEligibilityPending
              ? <p>{scoringWindowError ? "We could not check score availability. You can save your resume, but its score will not be updated." : "Checking whether this resume can update your score. You can still save your resume."}</p>
              : nextScoringAt
                ? <p>Your next resume can be scored on {scoringAvailabilityLabel(nextScoringAt)}.</p>
                : <p>Your resume can be saved now, but its score cannot be updated yet.</p>}
            {savedWithoutScoring && <p className="font-medium text-[#3A4761]">Resume saved. Your score was not updated.</p>}
          </div>
        )}
        {scoreUpdateUnavailable && hasPendingSave && (
          <PillButton variant="secondary" onClick={() => void saveChanges(true)} isLoading={savingResume} disabled={busy} className="w-full py-3 lg:py-2.5 lg:text-[13px]">
            Save resume only
          </PillButton>
        )}
        <div className="flex items-center justify-between gap-3 text-[12px] leading-4 text-[#5F6B80]">
          <span>Your edits create a new resume version.</span>
          <button type="button" disabled={busy || !canConfirm} onClick={() => { setDraft(structuredClone(version.structuredResume!)); setDirty(false); closeDrawer(); setError(null); onStartOver(); }} className="cursor-pointer font-semibold text-[#3A4761] transition hover:text-[#0A1931] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-[#3A4761]">{startOverLabel}</button>
        </div>
      </div>
      {editing && drawerDraft && typeof document !== "undefined" && createPortal(
        <div data-scroll-lock-root className="fixed inset-0 z-[100] flex justify-end bg-[#0A1931]/40" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
          <aside ref={drawerRef} role="dialog" aria-modal="true" aria-labelledby={drawerTitleId} tabIndex={-1} className="flex h-full w-full flex-col bg-[#FFFCF7] font-sans shadow-[-16px_0_48px_rgba(10,25,49,0.18)] outline-none sm:max-w-[540px] lg:max-w-[480px]">
            <form noValidate onSubmit={(event) => { event.preventDefault(); applyDrawer(); }} className="flex min-h-0 flex-1 flex-col">
              <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#E7E0D4] bg-white px-5 py-4 sm:px-6 lg:px-5 lg:py-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-[#F1EAF7] text-[#5F4DB2] lg:h-9 lg:w-9"><DrawerIcon size={18} aria-hidden="true" /></span>
                  <div className="min-w-0">
                    <h2 id={drawerTitleId} className="text-[18px] font-bold leading-6 text-[#0A1931] lg:text-[16px] lg:leading-5">Edit {selectedSection?.label.toLowerCase()}</h2>
                    <p className="mt-1 text-[13px] leading-5 text-[#5F6B80] lg:text-[12px] lg:leading-4">Update the details, then apply them to your resume review.</p>
                  </div>
                </div>
                <button type="button" onClick={closeDrawer} aria-label="Close resume editor" className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-full border border-[#E7E0D4] bg-white text-[#3A4761] transition hover:bg-[#F7F4EC] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30 lg:h-8 lg:w-8"><X size={16} aria-hidden="true" /></button>
              </header>
              <div className="bp-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6 lg:px-5 lg:py-4">
                {editing === "basics" ? (
                  <div className="grid gap-4 lg:gap-3">
                    {(["full_name", "headline", "location", "summary"] as const).map((field) => <InputTree key={field} name={field} value={drawerDraft[field]} path={[field]} onChange={changeDrawer} issues={drawerIssues} />)}
                  </div>
                ) : editing === "contacts" ? (
                  <div className="space-y-5 lg:space-y-4">
                    {contactGroups.map(({ title: groupTitle, fields }) => (
                      <section key={groupTitle} className="space-y-3 lg:space-y-2.5">
                        <h3 className="border-b border-[#E7E0D4] pb-2 text-[12px] font-bold uppercase tracking-[0.08em] text-[#5F6B80] lg:text-[11px]">{groupTitle}</h3>
                        <div className="grid gap-3 sm:grid-cols-2">
                          {fields.map((field) => <InputTree key={field} name={field} value={drawerDraft.contacts[field]} path={["contacts", field]} onChange={changeDrawer} issues={drawerIssues} />)}
                        </div>
                      </section>
                    ))}
                    <InputTree name="others" value={drawerDraft.contacts.others} path={["contacts", "others"]} onChange={changeDrawer} issues={drawerIssues} />
                  </div>
                ) : <InputTree name={editing} value={drawerDraft[editing]} path={[editing]} onChange={changeDrawer} issues={drawerIssues} />}
              </div>
              <footer className="flex shrink-0 flex-col gap-3 border-t border-[#E7E0D4] bg-white px-5 py-4 sm:px-6 lg:gap-2 lg:px-5 lg:py-3">
                <p className="text-[12px] leading-4 text-[#5F6B80] lg:text-[11px]">Apply your changes here, then save the resume from the review page.</p>
                <div className="flex gap-3">
                  <PillButton variant="secondary" onClick={closeDrawer} className="min-w-24 py-3 text-[14px] lg:py-2.5 lg:text-[13px]">Cancel</PillButton>
                  <PillButton type="submit" className="flex-1 py-3 text-[14px] lg:py-2.5 lg:text-[13px]"><Check size={16} aria-hidden="true" /> Apply changes</PillButton>
                </div>
              </footer>
            </form>
          </aside>
        </div>,
        document.body,
      )}
    </div>
  );
}
