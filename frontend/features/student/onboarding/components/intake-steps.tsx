"use client";

import { useRef, useState } from "react";
import {
  ArrowRight,
  ClipboardList,
  Plus,
  SquarePen,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { getApiErrorMessage } from "@/lib/api/error-message";
import {
  useEditResumeVersionMutation,
  useSubmitManualResumeMutation,
  useSubmitResumeTextMutation,
  type ManualEducation,
  type ManualExperience,
  type ManualResume,
} from "@/store/student";

import {
  Card,
  ErrorNote,
  Eyebrow,
  Field,
  fieldBorder,
  fieldClass,
  LockNote,
  PillButton,
  StepHeader,
} from "./ui";

/* The backend's defaults (`resume_max_upload_bytes`, allowed types). The
   upload ticket carries the live values and those win. */
export const RESUME_MAX_BYTES = 10 * 1024 * 1024;
const RESUME_EXTENSIONS = [".pdf", ".docx"];
const RESUME_TYPES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

export function resumeFileProblem(file: File, maxBytes = RESUME_MAX_BYTES): string | null {
  const name = file.name.toLowerCase();
  const knownType = RESUME_TYPES.includes(file.type);
  const knownExtension = RESUME_EXTENSIONS.some((extension) => name.endsWith(extension));

  if (name.endsWith(".doc")) {
    return "Old .doc files cannot be read. Save it as a PDF or .docx and try again.";
  }
  if (!knownType && !knownExtension) {
    return "Choose a PDF or .docx file.";
  }
  if (file.size === 0) {
    return "That file is empty. Choose another one.";
  }
  if (file.size > maxBytes) {
    return `That file is larger than ${Math.round(maxBytes / (1024 * 1024))} MB. Choose a smaller one.`;
  }
  return null;
}

/* -------------------------------------------------------------------------
 * 04 Resume intake
 * ---------------------------------------------------------------------- */
interface IntakeStepProps {
  onFile: (file: File) => void;
  onPaste: () => void;
  onForm: () => void;
  onBack?: () => void;
  error?: string | null;
}

export function IntakeStep({ onFile, onPaste, onForm, onBack, error }: Readonly<IntakeStepProps>) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);

  const accept = (file: File | undefined) => {
    if (!file) return;
    const problem = resumeFileProblem(file);
    if (problem) {
      setFileError(problem);
      return;
    }
    setFileError(null);
    onFile(file);
  };

  const shownError = fileError ?? error ?? null;

  return (
    <div className="flex flex-col gap-5">
      <StepHeader
        step="intake"
        title={
          <>
            How would you <br className="sm:hidden" />
            like to start?
          </>
        }
        subtitle="Pick whichever is fastest for you."
      />

      {shownError && <ErrorNote>{shownError}</ErrorNote>}

      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        className="sr-only"
        aria-label="Choose your resume file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          accept(file);
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          accept(event.dataTransfer.files?.[0]);
        }}
        className={`flex cursor-pointer flex-col gap-4 rounded-[20px] border-0 bg-[#5E4DB2] p-5 text-left transition active:scale-[0.99] sm:p-6 ${
          dragging ? "ring-4 ring-[#5F4DB2]/30" : ""
        }`}
      >
        <span className="flex w-full items-start justify-between">
          <span className="grid h-11 w-11 place-items-center rounded-full bg-[#4A3E8F]">
            <Upload className="h-[21px] w-[21px] text-[#FFFCF7]" aria-hidden="true" />
          </span>
          <span className="rounded-full border border-[#DDD6C7] bg-white px-3 py-2 text-[11px] font-bold tracking-[0.08em] text-[#0A1931]">
            FASTEST
          </span>
        </span>
        <span className="flex flex-col gap-1">
          <span className="text-[22px] font-bold leading-[26px] tracking-[-0.02em] text-white">
            Upload a file
          </span>
          <span className="text-[14px] leading-5 text-[#E0DBF4]">
            We read it in about 20 seconds.{" "}
            <span className="hidden sm:inline">Or drop it here.</span>
          </span>
        </span>
        <span className="flex w-full items-center gap-2.5 border-t border-[rgba(255,252,247,0.28)] pt-3.5">
          <span className="flex-1 text-[11px] font-bold tracking-[0.1em] text-[#E0DBF4]">
            PDF · DOCX · UP TO {Math.round(RESUME_MAX_BYTES / (1024 * 1024))} MB
          </span>
          <ArrowRight className="h-4 w-4 text-[#FFFCF7]" aria-hidden="true" />
        </span>
      </button>

      <div className="-mt-1 grid grid-cols-2 gap-4">
        <IntakeOption
          icon={<ClipboardList className="h-[18px] w-[18px] text-[#FFFCF7]" aria-hidden="true" />}
          title="Paste text"
          body="From email or notes"
          onClick={onPaste}
        />
        <IntakeOption
          icon={<SquarePen className="h-[18px] w-[18px] text-[#FFFCF7]" aria-hidden="true" />}
          title="Fill a form"
          body="No resume yet"
          onClick={onForm}
        />
      </div>

      <div className="mt-2 flex flex-col gap-3">
        {onBack && (
          <PillButton variant="secondary" onClick={onBack} className="w-full">
            Back
          </PillButton>
        )}
        <LockNote>Only used to build your profile</LockNote>
      </div>
    </div>
  );
}

function IntakeOption({
  icon,
  title,
  body,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer flex-col gap-4 rounded-[20px] border border-[#E7E0D4] bg-white p-4 text-left transition hover:border-[#5F4DB2] sm:p-5"
    >
      <span className="grid h-9 w-9 place-items-center rounded-[12px] bg-[#5F4DB2]">{icon}</span>
      <span className="flex flex-col gap-1">
        <span className="text-[16px] font-bold leading-5 text-[#0A1931]">{title}</span>
        <span className="text-[12px] leading-4 text-[#5F6B80]">{body}</span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------
 * Paste text
 * ---------------------------------------------------------------------- */
const MIN_PASTE_CHARS = 50;

export function PasteStep({
  onBack,
  onCreated,
}: {
  onBack: () => void;
  onCreated: (resumeVersionId: string) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitText, { isLoading }] = useSubmitResumeTextMutation();
  const usable = text.split(/\s+/).join(" ").trim().length;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (usable < MIN_PASTE_CHARS) {
      setError("That is too short to be a resume. Paste the whole thing.");
      return;
    }

    try {
      const created = await submitText(text).unwrap();
      onCreated(created.resumeVersionId);
    } catch (failure) {
      setError(getApiErrorMessage(failure, "We could not read that text. Please try again."));
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <StepHeader
        title="Paste your resume"
        subtitle="Copy everything from your email or notes. We keep the text exactly as you paste it."
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <Field id="paste-text" label="Resume text">
        <textarea
          id="paste-text"
          autoFocus
          rows={14}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setError(null);
          }}
          placeholder={"Priya Deshmukh\nPune, Maharashtra\n\nEducation\nB.Sc Microbiology, Fergusson College, 2022–2025\n\nSkills\nMicrobial culturing, Lab reporting, MS Excel"}
          className={`${fieldClass} ${fieldBorder(Boolean(error))} min-h-[320px] resize-y text-[15px] font-normal leading-6`}
        />
      </Field>
      <p className="m-0 -mt-3 text-right text-[12px] text-[#5F6B80]">
        {usable < MIN_PASTE_CHARS
          ? `${MIN_PASTE_CHARS - usable} more characters needed`
          : `${usable} characters`}
      </p>

      <div className="flex gap-2">
        <PillButton variant="secondary" onClick={onBack} className="flex-1">
          Back
        </PillButton>
        <PillButton type="submit" isLoading={isLoading} className="flex-[2]">
          Read my resume
        </PillButton>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------
 * Fill a form (the structured path, PRD 4.2). No date of birth or age - ever.
 * ---------------------------------------------------------------------- */
type YearText = string;

interface ExperienceDraft {
  employer: string;
  title: string;
  startYear: YearText;
  endYear: YearText;
  summary: string;
}

interface EducationDraft {
  institution: string;
  qualification: string;
  completedYear: YearText;
}

const emptyExperience = (): ExperienceDraft => ({
  employer: "",
  title: "",
  startYear: "",
  endYear: "",
  summary: "",
});

const emptyEducation = (): EducationDraft => ({
  institution: "",
  qualification: "",
  completedYear: "",
});

function yearOf(value: YearText): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const year = Number(trimmed);
  return Number.isInteger(year) ? year : Number.NaN;
}

function validYear(year: number | null): boolean {
  return year === null || (Number.isInteger(year) && year >= 1950 && year <= 2100);
}

interface ManualStepProps {
  initial?: ManualResume;
  defaultName: string;
  /** Set when correcting an existing structured version. */
  editOf?: string;
  onBack: () => void;
  onCreated: (resumeVersionId: string) => void;
}

export function ManualStep({
  initial,
  defaultName,
  editOf,
  onBack,
  onCreated,
}: Readonly<ManualStepProps>) {
  const [fullName, setFullName] = useState(initial?.full_name ?? defaultName);
  const [headline, setHeadline] = useState(initial?.headline ?? "");
  const [education, setEducation] = useState<EducationDraft[]>(
    initial?.education.length
      ? initial.education.map((item) => ({
          institution: item.institution,
          qualification: item.qualification,
          completedYear: item.completed_year ? String(item.completed_year) : "",
        }))
      : [emptyEducation()],
  );
  const [experience, setExperience] = useState<ExperienceDraft[]>(
    initial?.experience.map((item) => ({
      employer: item.employer,
      title: item.title,
      startYear: String(item.start_year),
      endYear: item.end_year ? String(item.end_year) : "",
      summary: item.summary ?? "",
    })) ?? [],
  );
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? []);
  const [skillDraft, setSkillDraft] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const [submitManual, createState] = useSubmitManualResumeMutation();
  const [editVersion, editState] = useEditResumeVersionMutation();
  const saving = createState.isLoading || editState.isLoading;

  const addSkill = () => {
    const parts = skillDraft
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    setSkills((current) => {
      const seen = new Set(current.map((skill) => skill.toLowerCase()));
      const next = [...current];
      for (const part of parts) {
        if (part.length <= 80 && !seen.has(part.toLowerCase()) && next.length < 100) {
          next.push(part);
          seen.add(part.toLowerCase());
        }
      }
      return next;
    });
    setSkillDraft("");
  };

  const build = (): ManualResume | null => {
    const nextErrors: Record<string, string> = {};

    if (!fullName.trim()) nextErrors.fullName = "Enter your name.";

    const educationRows: ManualEducation[] = [];
    education.forEach((row, index) => {
      const blank = !row.institution.trim() && !row.qualification.trim() && !row.completedYear.trim();
      if (blank) return;
      const year = yearOf(row.completedYear);
      if (!row.institution.trim()) nextErrors[`edu-${index}-institution`] = "Enter the institution.";
      if (!row.qualification.trim()) nextErrors[`edu-${index}-qualification`] = "Enter the course or class.";
      if (!validYear(year)) nextErrors[`edu-${index}-year`] = "Enter a year like 2024.";
      educationRows.push({
        institution: row.institution.trim(),
        qualification: row.qualification.trim(),
        completed_year: year,
      });
    });

    const experienceRows: ManualExperience[] = [];
    experience.forEach((row, index) => {
      const blank =
        !row.employer.trim() && !row.title.trim() && !row.startYear.trim() && !row.endYear.trim() && !row.summary.trim();
      if (blank) return;
      const start = yearOf(row.startYear);
      const end = yearOf(row.endYear);
      if (!row.employer.trim()) nextErrors[`exp-${index}-employer`] = "Enter where you worked.";
      if (!row.title.trim()) nextErrors[`exp-${index}-title`] = "Enter your role.";
      if (start === null || !validYear(start)) nextErrors[`exp-${index}-start`] = "Enter a year like 2023.";
      if (!validYear(end)) nextErrors[`exp-${index}-end`] = "Enter a year like 2024.";
      else if (start !== null && end !== null && end < start) {
        nextErrors[`exp-${index}-end`] = "The end is before the start.";
      }
      experienceRows.push({
        employer: row.employer.trim(),
        title: row.title.trim(),
        start_year: start ?? 0,
        end_year: end,
        summary: row.summary.trim() || null,
      });
    });

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return null;

    return {
      full_name: fullName.trim(),
      headline: headline.trim() || null,
      education: educationRows,
      experience: experienceRows,
      skills,
    };
  };

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);
    const resume = build();
    if (!resume) {
      setServerError("Some details need attention. Check the highlighted fields.");
      return;
    }

    try {
      const created = editOf
        ? await editVersion({ resumeVersionId: editOf, edit: { structured: resume } }).unwrap()
        : await submitManual(resume).unwrap();
      onCreated(created.resumeVersionId);
    } catch (failure) {
      setServerError(getApiErrorMessage(failure, "We could not save your resume. Please try again."));
    }
  };

  const fieldProps = (key: string) => ({
    "aria-invalid": Boolean(errors[key]),
    className: `${fieldClass} ${fieldBorder(Boolean(errors[key]))}`,
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <StepHeader
        title={editOf ? "Correct your details" : "Build your resume"}
        subtitle="No resume yet? Fill in what you have. You can add more later."
      />

      {serverError && <ErrorNote>{serverError}</ErrorNote>}

      <Card className="flex flex-col gap-4 p-5">
        <Eyebrow>Basics</Eyebrow>
        <Field id="manual-name" label="Full name" error={errors.fullName}>
          <input
            id="manual-name"
            value={fullName}
            maxLength={200}
            onChange={(event) => setFullName(event.target.value)}
            {...fieldProps("fullName")}
          />
        </Field>
        <Field id="manual-headline" label="One line about you" optional>
          <input
            id="manual-headline"
            value={headline}
            maxLength={300}
            placeholder="e.g. Microbiology graduate looking for lab roles"
            onChange={(event) => setHeadline(event.target.value)}
            className={`${fieldClass} ${fieldBorder(false)}`}
          />
        </Field>
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <Eyebrow>Education</Eyebrow>
        {education.map((row, index) => (
          <div key={index} className="flex flex-col gap-3 border-b border-[#F7EFD6] pb-4 last:border-0 last:pb-0">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id={`edu-${index}-qualification`} label="Course or class" error={errors[`edu-${index}-qualification`]}>
                <input
                  id={`edu-${index}-qualification`}
                  value={row.qualification}
                  maxLength={200}
                  placeholder="e.g. B.Sc Microbiology"
                  onChange={(event) =>
                    setEducation((rows) => rows.map((item, i) => (i === index ? { ...item, qualification: event.target.value } : item)))
                  }
                  {...fieldProps(`edu-${index}-qualification`)}
                />
              </Field>
              <Field id={`edu-${index}-institution`} label="Institution" error={errors[`edu-${index}-institution`]}>
                <input
                  id={`edu-${index}-institution`}
                  value={row.institution}
                  maxLength={200}
                  placeholder="e.g. Fergusson College, Pune"
                  onChange={(event) =>
                    setEducation((rows) => rows.map((item, i) => (i === index ? { ...item, institution: event.target.value } : item)))
                  }
                  {...fieldProps(`edu-${index}-institution`)}
                />
              </Field>
            </div>
            <div className="flex items-end gap-3">
              <div className="w-40">
                <Field id={`edu-${index}-year`} label="Year completed" optional error={errors[`edu-${index}-year`]}>
                  <input
                    id={`edu-${index}-year`}
                    inputMode="numeric"
                    value={row.completedYear}
                    maxLength={4}
                    placeholder="2025"
                    onChange={(event) =>
                      setEducation((rows) => rows.map((item, i) => (i === index ? { ...item, completedYear: event.target.value } : item)))
                    }
                    {...fieldProps(`edu-${index}-year`)}
                  />
                </Field>
              </div>
              {education.length > 1 && (
                <RemoveButton label="Remove this course" onClick={() => setEducation((rows) => rows.filter((_, i) => i !== index))} />
              )}
            </div>
          </div>
        ))}
        {education.length < 20 && (
          <AddButton onClick={() => setEducation((rows) => [...rows, emptyEducation()])}>Add education</AddButton>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <Eyebrow>Experience &amp; projects</Eyebrow>
        {experience.length === 0 && (
          <p className="m-0 text-[14px] leading-5 text-[#5F6B80]">
            Internships, part-time work and projects all count.
          </p>
        )}
        {experience.map((row, index) => (
          <div key={index} className="flex flex-col gap-3 border-b border-[#F7EFD6] pb-4 last:border-0 last:pb-0">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id={`exp-${index}-title`} label="Role" error={errors[`exp-${index}-title`]}>
                <input
                  id={`exp-${index}-title`}
                  value={row.title}
                  maxLength={200}
                  placeholder="e.g. Intern — Quality lab"
                  onChange={(event) =>
                    setExperience((rows) => rows.map((item, i) => (i === index ? { ...item, title: event.target.value } : item)))
                  }
                  {...fieldProps(`exp-${index}-title`)}
                />
              </Field>
              <Field id={`exp-${index}-employer`} label="Organisation" error={errors[`exp-${index}-employer`]}>
                <input
                  id={`exp-${index}-employer`}
                  value={row.employer}
                  maxLength={200}
                  placeholder="e.g. Sahyadri Dairy, Pune"
                  onChange={(event) =>
                    setExperience((rows) => rows.map((item, i) => (i === index ? { ...item, employer: event.target.value } : item)))
                  }
                  {...fieldProps(`exp-${index}-employer`)}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:w-[340px]">
              <Field id={`exp-${index}-start`} label="From (year)" error={errors[`exp-${index}-start`]}>
                <input
                  id={`exp-${index}-start`}
                  inputMode="numeric"
                  value={row.startYear}
                  maxLength={4}
                  placeholder="2024"
                  onChange={(event) =>
                    setExperience((rows) => rows.map((item, i) => (i === index ? { ...item, startYear: event.target.value } : item)))
                  }
                  {...fieldProps(`exp-${index}-start`)}
                />
              </Field>
              <Field id={`exp-${index}-end`} label="To (year)" optional error={errors[`exp-${index}-end`]}>
                <input
                  id={`exp-${index}-end`}
                  inputMode="numeric"
                  value={row.endYear}
                  maxLength={4}
                  placeholder="Now"
                  onChange={(event) =>
                    setExperience((rows) => rows.map((item, i) => (i === index ? { ...item, endYear: event.target.value } : item)))
                  }
                  {...fieldProps(`exp-${index}-end`)}
                />
              </Field>
            </div>
            <Field id={`exp-${index}-summary`} label="What you did" optional>
              <textarea
                id={`exp-${index}-summary`}
                rows={3}
                value={row.summary}
                maxLength={2000}
                placeholder="One or two lines on what you worked on and what came of it."
                onChange={(event) =>
                  setExperience((rows) => rows.map((item, i) => (i === index ? { ...item, summary: event.target.value } : item)))
                }
                className={`${fieldClass} ${fieldBorder(false)} resize-y text-[15px] font-normal`}
              />
            </Field>
            <div className="flex justify-end">
              <RemoveButton label="Remove this entry" onClick={() => setExperience((rows) => rows.filter((_, i) => i !== index))} />
            </div>
          </div>
        ))}
        {experience.length < 40 && (
          <AddButton onClick={() => setExperience((rows) => [...rows, emptyExperience()])}>Add experience or project</AddButton>
        )}
      </Card>

      <Card className="flex flex-col gap-4 p-5">
        <Eyebrow>Skills</Eyebrow>
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {skills.map((skill) => (
              <span
                key={skill}
                className="flex items-center gap-1.5 rounded-full bg-[#F7EFD6] py-2 pl-3 pr-2 text-[13px] font-medium text-[#0A1931]"
              >
                {skill}
                <button
                  type="button"
                  aria-label={`Remove ${skill}`}
                  onClick={() => setSkills((current) => current.filter((item) => item !== skill))}
                  className="grid h-5 w-5 cursor-pointer place-items-center rounded-full text-[#5F6B80] hover:bg-white"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            aria-label="Add a skill"
            value={skillDraft}
            maxLength={200}
            placeholder="Type a skill and press Enter"
            onChange={(event) => setSkillDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                addSkill();
              }
            }}
            className={`${fieldClass} ${fieldBorder(false)} flex-1`}
          />
          <PillButton variant="secondary" onClick={addSkill} className="px-5 py-3 text-[14px]">
            Add
          </PillButton>
        </div>
      </Card>

      <div className="flex gap-2">
        <PillButton variant="secondary" onClick={onBack} className="flex-1">
          Back
        </PillButton>
        <PillButton type="submit" isLoading={saving} className="flex-[2]">
          {editOf ? "Save changes" : "Review my details"}
        </PillButton>
      </div>
    </form>
  );
}

function AddButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-fit cursor-pointer items-center gap-1.5 rounded-full bg-[#5F4DB2] px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-[#4A3E8F]"
    >
      <Plus className="h-3 w-3" aria-hidden="true" />
      {children}
    </button>
  );
}

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-semibold text-[#993A22] transition hover:bg-[#F8E6E0]"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
