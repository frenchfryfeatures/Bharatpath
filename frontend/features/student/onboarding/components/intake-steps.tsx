"use client";

import { useRef, useState } from "react";
import {ResumeContentFields} from "./resume-builder-step";
import {fromManualResume} from "@/lib/resume/editor-document";
import {validateReviewedResume} from "./resume-review-validation";
import { StudentBackButton } from "@/features/student/components/student-back-button";
import {
  ArrowRight,
  ClipboardList,
  Sparkles,
  SquarePen,
  Upload,
  X,
} from "lucide-react";

import { getApiErrorMessage } from "@/lib/api/error-message";
import {
  useEditResumeVersionMutation,
  useSubmitResumeDocumentMutation,
  useSubmitResumeTextMutation,
  type ManualResume,
} from "@/store/student";

import {
  ErrorNote,
  fieldBorder,
  fieldClass,
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
          <StudentBackButton onClick={onBack} />
        )}
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
  const characterCount = text.trim().length;
  const sampleResume = "Priya Deshmukh\nPune, Maharashtra\n\nWork Experience\nQuality Lab Intern, Sahyadri Dairy, 2023–2024\nAssisted with sample testing, quality reports, and lab documentation.\n\nEducation\nB.Sc Microbiology, Fergusson College, 2022\n\nSkills\nMicrobial culturing, Lab reporting, MS Excel";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);

    if (characterCount < MIN_PASTE_CHARS) {
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
    <div className="flex min-w-0 flex-col gap-5 text-[#0A1931]">
      <header className="border-b border-[#E7E0D4] pb-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#F1EAF7] text-[#5F4DB2]"><ClipboardList size={23} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1"><h1 className="text-[18px] font-semibold leading-6 tracking-[-0.02em] sm:text-[21px]">Paste your CV / Resume</h1><p className="mt-0.5 text-[13px] text-[#5F6B80] sm:text-[14px]">No file needed · Minimum 50 chars</p></div>
          <button type="button" onClick={onBack} aria-label="Close paste resume" className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#F3F0E8] text-[#0A1931] transition hover:bg-[#EAE5D9] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/40"><X size={23} aria-hidden="true" /></button>
        </div>
      </header>

      <form id="paste-resume-form" onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-5">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <button type="button" onClick={() => { setText(sampleResume); setError(null); }} className="flex w-fit items-center gap-2 rounded-full border border-[#D9CFF0] bg-[#F1EAF7] px-4 py-2.5 text-[14px] font-medium text-[#5F4DB2] transition hover:bg-[#E8DFF2]"><Sparkles size={17} aria-hidden="true" />Use sample CV</button>
        <textarea
          id="paste-text"
          aria-label="Paste your full resume or CV text"
          autoFocus
          value={text}
          onChange={(event) => { setText(event.target.value); setError(null); }}
          placeholder="Paste your full resume or CV text here... Include your work experience, education, skills, and summary so the scoring engine can analyze your profile accurately."
          className={`${fieldClass} ${fieldBorder(Boolean(error))} min-h-[42vh] flex-1 resize-y rounded-[24px] border-2 px-5 py-5 text-[16px] font-normal leading-6 shadow-sm placeholder:text-[#8993A1] sm:min-h-[480px] sm:px-6 sm:py-6`}
        />
        <div className="flex items-center justify-between gap-3 px-1 text-[13px] font-semibold text-[#85650F] sm:text-[14px]">
          <span>{characterCount} / {MIN_PASTE_CHARS} characters min</span>
          <span className="text-right">{characterCount < MIN_PASTE_CHARS ? `${MIN_PASTE_CHARS - characterCount} more characters needed` : "Ready to continue"}</span>
        </div>
        <section className="rounded-[20px] border border-[#E7E0D4] bg-[#F7F4EC] p-4 sm:p-5">
          <h2 className="mb-2 flex items-center gap-2 text-[14px] font-semibold text-[#0A1931]"><span aria-hidden="true">💡</span>What to include for best scoring</h2>
          <ul className="m-0 list-disc space-y-1 pl-5 text-[13px] leading-5 text-[#5F6B80] sm:text-[14px]">
            <li>Job titles, company names, and dates of work</li>
            <li>Degrees, colleges, and completion years</li>
            <li>Technical and professional skills</li>
          </ul>
        </section>
      </form>

      <footer className="sticky bottom-0 z-20 border-t border-[#E7E0D4] bg-[#FFFCF7]/95 py-3 backdrop-blur">
        <div className="flex gap-3">
          <StudentBackButton onClick={onBack} />
          <PillButton type="submit" form="paste-resume-form" isLoading={isLoading} disabled={characterCount < MIN_PASTE_CHARS} className="flex-1 rounded-[16px] py-3.5">Continue &amp; Parse</PillButton>
        </div>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Fill a form (the structured path, PRD 4.2). No date of birth or age - ever.
 * ---------------------------------------------------------------------- */
interface ManualStepProps {
  initial?: ManualResume;
  defaultName: string;
  /** Set when correcting an existing structured version. */
  editOf?: string;
  onBack: () => void;
  onCreated: (resumeVersionId: string) => void;
}

export function ManualStep({initial,defaultName,editOf,onBack,onCreated}:Readonly<ManualStepProps>) {
 const [document,setDocument]=useState(()=>fromManualResume(initial,defaultName));
 const [showErrors,setShowErrors]=useState(false);const [error,setError]=useState<string|null>(null);
 const [submit,state]=useSubmitResumeDocumentMutation();const [edit,editState]=useEditResumeVersionMutation();
 const busy=state.isLoading||editState.isLoading;
 return <form onSubmit={async event=>{event.preventDefault();setShowErrors(true);const issues=validateReviewedResume(document);if(issues.length){setError(issues[0].message);return;}setError(null);try{const result=editOf?await edit({resumeVersionId:editOf,edit:{structured_resume:document}}).unwrap():await submit(document).unwrap();onCreated(result.resumeVersionId);}catch(failure){setError(getApiErrorMessage(failure,"Your resume could not be saved. Please retry."));}}} className="space-y-5">
 <StudentBackButton onClick={onBack}>Back</StudentBackButton>
 <StepHeader title="Create your resume" subtitle="Enter the same resume details used throughout BharatPath."/>
 {error&&<ErrorNote>{error}</ErrorNote>}
 <ResumeContentFields content={document} onChange={setDocument} showValidation={showErrors}/>
 <PillButton type="submit" disabled={busy} isLoading={busy}>Save resume and continue</PillButton>
 </form>;
}
