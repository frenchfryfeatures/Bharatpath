"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertCircle,
  Award,
  Briefcase,
  Check,
  FileText,
  FlaskConical,
  GraduationCap,
  Languages,
  Pencil,
  PencilLine,
  Plus,
  TriangleAlert,
  Trophy,
  User,
  Users,
  Wrench,
  X,
} from "lucide-react";

import { FormSkeleton } from "@/components/common/loading";
import { getApiErrorCode, getApiErrorMessage } from "@/lib/api/error-message";
import {
  useConfirmResumeVersionMutation,
  useEditResumeVersionMutation,
  useGetResumeVersionQuery,
  type ManualResume,
  type ResumeSection,
  type ResumeSectionItem,
  type ResumeSectionKind,
  type ResumeVersionDetail,
} from "@/store/student";

import {
  Card,
  DoneDot,
  ErrorNote,
  Eyebrow,
  fieldBorder,
  fieldClass,
  PillButton,
  StepHeader,
} from "./ui";

const KIND_META: Record<ResumeSectionKind, { label: string; icon: ReactNode; noun: string }> = {
  header: { label: "Basics", icon: <User className="h-4 w-4" />, noun: "detail" },
  summary: { label: "Summary", icon: <FileText className="h-4 w-4" />, noun: "summary" },
  experience: { label: "Experience", icon: <Briefcase className="h-4 w-4" />, noun: "experience" },
  projects: { label: "Projects", icon: <FlaskConical className="h-4 w-4" />, noun: "project" },
  education: { label: "Education", icon: <GraduationCap className="h-4 w-4" />, noun: "course" },
  skills: { label: "Skills", icon: <Wrench className="h-4 w-4" />, noun: "skill" },
  certifications: { label: "Certificates", icon: <Award className="h-4 w-4" />, noun: "certificate" },
  languages: { label: "Languages", icon: <Languages className="h-4 w-4" />, noun: "language" },
  achievements: { label: "Achievements", icon: <Trophy className="h-4 w-4" />, noun: "achievement" },
  activities: { label: "Activities", icon: <Users className="h-4 w-4" />, noun: "activity" },
  personal: { label: "Personal details", icon: <User className="h-4 w-4" />, noun: "detail" },
};

/** A kind added to the backend later still renders, as plain text. */
const FALLBACK_META = { label: "Other", icon: <FileText className="h-4 w-4" />, noun: "item" };

function metaOf(kind: string) {
  return KIND_META[kind as ResumeSectionKind] ?? FALLBACK_META;
}

/** Sections worth prompting for when the resume has none. */
const PROMPTED_KINDS: ResumeSectionKind[] = ["education", "experience", "projects", "skills"];

interface ReviewStepProps {
  resumeVersionId: string;
  onConfirmed: (confirmedAt: string) => void;
  onEditStructured: (resume: ManualResume, resumeVersionId: string) => void;
  onStartOver: () => void;
}

/* -------------------------------------------------------------------------
 * 06 Review parsed data -> 07 Fix a field -> confirm
 * ---------------------------------------------------------------------- */
export function ReviewStep({
  resumeVersionId,
  onConfirmed,
  onEditStructured,
  onStartOver,
}: Readonly<ReviewStepProps>) {
  const version = useGetResumeVersionQuery(resumeVersionId);

  if (version.isLoading) {
    return (
      <div className="flex flex-col gap-5">
        <StepHeader title="Review details" subtitle="Nothing is scored until you confirm." />
        <FormSkeleton fields={5} actions={false} />
      </div>
    );
  }

  if (version.isError || !version.data) {
    return (
      <div className="flex flex-col gap-5">
        <StepHeader title="Review details" />
        <ErrorNote>
          {getApiErrorMessage(version.error, "We could not load what we read. Please try again.")}
        </ErrorNote>
        <div className="flex gap-2">
          <PillButton variant="secondary" onClick={onStartOver} className="flex-1">
            Start over
          </PillButton>
          <PillButton onClick={() => void version.refetch()} className="flex-1">
            Try again
          </PillButton>
        </div>
      </div>
    );
  }

  return version.data.sections ? (
    <SectionsReview
      key={version.data.resumeVersionId}
      version={version.data}
      sections={version.data.sections}
      onConfirmed={onConfirmed}
      onStartOver={onStartOver}
    />
  ) : (
    <StructuredReview
      version={version.data}
      onConfirmed={onConfirmed}
      onEdit={onEditStructured}
      onStartOver={onStartOver}
    />
  );
}

/* -------------------------------------------------------------------------
 * Text versions: the resume as sections, each correctable.
 * ---------------------------------------------------------------------- */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
 * Items are separated by commas, semicolons, pipes, bullets or line breaks
 * (`sections.section_items`). An item is matched only between two of those,
 * so fixing "Java" never touches the "Java" inside "JavaScript".
 */
const SEPARATOR = "[,;|\\n•●▪■◦‣►➢✓·]";

function itemPattern(text: string, flags = ""): RegExp {
  return new RegExp(
    `(^|${SEPARATOR})([ \\t]*(?:[-*][ \\t]+)?)${escapeRegExp(text)}(?=[ \\t]*(?:${SEPARATOR}|$))`,
    flags,
  );
}

/** Replace one item's text in the section body, keeping its layout. */
function replaceItem(body: string, from: string, to: string, items: ResumeSectionItem[]): string {
  const pattern = itemPattern(from);
  if (pattern.test(body)) {
    return body.replace(pattern, (_match, lead: string, gap: string) => `${lead}${gap}${to}`);
  }
  return items.map((item) => (item.text === from ? to : item.text)).join("\n");
}

/** Remove one item from the section body with the separator beside it. */
function removeItem(body: string, text: string, items: ResumeSectionItem[]): string {
  const lines = body.split("\n");
  const bullet = /^[\s•●▪■◦‣►➢✓*-]*/;
  const lineIndex = lines.findIndex((line) => line.replace(bullet, "").trim() === text);
  if (lineIndex >= 0) {
    return lines.filter((_, i) => i !== lineIndex).join("\n");
  }

  const escaped = escapeRegExp(text);
  const inline = "[,;|•●▪■◦‣►➢✓·]";
  // "a, TEXT, b" -> "a, b"; "TEXT, b" -> "b"; "a, TEXT" -> "a".
  const followed = new RegExp(`(^|${inline}|\\n)[ \\t]*${escaped}[ \\t]*${inline}[ \\t]*`);
  if (followed.test(body)) {
    return body.replace(followed, (_match, lead: string) => (lead && lead !== "\n" ? `${lead} ` : lead));
  }
  const preceded = new RegExp(`[ \\t]*${inline}[ \\t]*${escaped}(?=[ \\t]*(?:\\n|$))`);
  if (preceded.test(body)) return body.replace(preceded, "");

  return items
    .filter((item) => item.text !== text)
    .map((item) => item.text)
    .join("\n");
}

interface DraftSection extends ResumeSection {
  /** Local key: sections are edited in place and have no id. */
  key: string;
}

type SheetState =
  | { type: "item"; sectionKey: string; item: ResumeSectionItem }
  | { type: "section"; sectionKey: string; adding?: boolean }
  | null;

function SectionsReview({
  version,
  sections,
  onConfirmed,
  onStartOver,
}: {
  version: ResumeVersionDetail;
  sections: ResumeSection[];
  onConfirmed: (confirmedAt: string) => void;
  onStartOver: () => void;
}) {
  const [drafts, setDrafts] = useState<DraftSection[]>(() =>
    sections.map((section, index) => ({ ...section, key: `${section.kind}-${index}` })),
  );
  const [dirty, setDirty] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [error, setError] = useState<string | null>(null);

  const [editVersion, editState] = useEditResumeVersionMutation();
  const [confirmVersion, confirmState] = useConfirmResumeVersionMutation();
  const busy = editState.isLoading || confirmState.isLoading;

  const unclear = drafts.reduce(
    (total, section) => total + (section.items?.filter((item) => item.unclear).length ?? 0),
    0,
  );
  const present = new Set(drafts.filter((section) => section.body.trim()).map((section) => section.kind));
  const missing = PROMPTED_KINDS.filter((kind) => !present.has(kind));

  const update = (key: string, change: (section: DraftSection) => DraftSection | null) => {
    setDrafts((current) =>
      current.flatMap((section) => {
        if (section.key !== key) return [section];
        const next = change(section);
        return next ? [next] : [];
      }),
    );
    setDirty(true);
    setError(null);
  };

  const confirm = async () => {
    setError(null);
    try {
      // An edit that already succeeded is a version of its own: never edit
      // the original again (it is superseded), confirm or re-edit that one.
      let target = createdId ?? version.resumeVersionId;

      if (dirty) {
        const edited = drafts
          .filter((section) => section.kind === "header" || section.body.trim())
          .map(({ kind, heading, body }) => ({ kind, heading, body }));
        const created = await editVersion({
          resumeVersionId: target,
          edit: { sections: edited },
          __suppressSuccessFeedback: true,
        }).unwrap();
        target = created.resumeVersionId;
        setCreatedId(target);
        setDirty(false);
      }

      const confirmed = await confirmVersion(target).unwrap();
      onConfirmed(confirmed.confirmedAt);
    } catch (failure) {
      const code = getApiErrorCode(failure);
      setError(
        code === "resume_version_superseded"
          ? "This resume was changed in another tab. Start over to review the latest version."
          : getApiErrorStatusText(failure),
      );
    }
  };

  const sheetSection = sheet ? drafts.find((section) => section.key === sheet.sectionKey) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <StepHeader
        title="Review details"
        subtitle="Nothing is scored until you confirm. Tap anything that looks wrong."
        badge={
          unclear > 0 ? (
            <span className="flex items-center gap-1.5 rounded-full border border-[#7A5C0E] bg-white px-2 py-1 text-[12px] font-bold leading-4 text-[#7A5C0E]">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              {unclear} to fix
            </span>
          ) : null
        }
      />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-col gap-3">
        {drafts.map((section) => (
          <SectionCard
            key={section.key}
            section={section}
            onEdit={() => setSheet({ type: "section", sectionKey: section.key })}
            onFixItem={(item) => setSheet({ type: "item", sectionKey: section.key, item })}
          />
        ))}

        {missing.length > 0 && (
          <Card className="flex flex-col gap-3 p-4">
            <Eyebrow>Missing from your resume</Eyebrow>
            {missing.map((kind) => (
              <div key={kind} className="flex items-center gap-3">
                <span className="flex-1 text-[14px] font-medium leading-5 text-[#5F6B80]">
                  {metaOf(kind).label} not found
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const key = `${kind}-new-${Date.now()}`;
                    setDrafts((current) => [...current, { key, kind, heading: null, body: "", items: null }]);
                    setSheet({ type: "section", sectionKey: key, adding: true });
                  }}
                  className="flex cursor-pointer items-center gap-1.5 rounded-full bg-[#5F4DB2] px-3.5 py-2 text-[12px] font-semibold text-white transition hover:bg-[#4A3E8F]"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  Add
                </button>
              </div>
            ))}
          </Card>
        )}
      </div>

      <div className="sticky bottom-0 -mx-1 flex flex-col gap-3 bg-[#FFFCF7] px-1 pb-3.5 pt-4">
        <PillButton onClick={() => void confirm()} isLoading={busy} className="w-full py-[18px]">
          {busy ? "Saving…" : "Confirm"}
        </PillButton>
        <div className="flex items-center justify-between gap-3 text-[12px] leading-4 text-[#5F6B80]">
          <span>You can edit any of this later.</span>
          <button
            type="button"
            onClick={onStartOver}
            className="cursor-pointer font-semibold text-[#3A4761] hover:text-[#0A1931]"
          >
            Use a different resume
          </button>
        </div>
      </div>

      {sheet?.type === "item" && sheetSection && (
        <FixItemSheet
          noun={metaOf(sheetSection.kind).noun}
          item={sheet.item}
          onClose={() => setSheet(null)}
          onRemove={() => {
            update(sheetSection.key, (section) => ({
              ...section,
              body: removeItem(section.body, sheet.item.text, section.items ?? []),
              items: (section.items ?? []).filter((item) => item !== sheet.item),
            }));
            setSheet(null);
          }}
          onSave={(text) => {
            update(sheetSection.key, (section) => ({
              ...section,
              body: replaceItem(section.body, sheet.item.text, text, section.items ?? []),
              items: (section.items ?? []).map((item) =>
                item === sheet.item ? { text, unclear: false, suggestion: null } : item,
              ),
            }));
            setSheet(null);
          }}
        />
      )}

      {sheet?.type === "section" && sheetSection && (
        <EditSectionSheet
          title={
            sheet.adding
              ? `Add ${metaOf(sheetSection.kind).label.toLowerCase()}`
              : `Edit ${(sheetSection.heading ?? metaOf(sheetSection.kind).label).toLowerCase()}`
          }
          body={sheetSection.body}
          onClose={() => {
            if (sheet.adding) {
              setDrafts((current) => current.filter((section) => section.key !== sheetSection.key));
            }
            setSheet(null);
          }}
          onSave={(body) => {
            update(sheetSection.key, (section) =>
              // Item chips are derived by the server; after a free-text edit
              // the text itself is shown until the next review.
              ({ ...section, body, items: null }),
            );
            setSheet(null);
          }}
        />
      )}
    </div>
  );
}

function getApiErrorStatusText(failure: unknown): string {
  return getApiErrorMessage(failure, "We could not save your changes. Please try again.");
}

function SectionCard({
  section,
  onEdit,
  onFixItem,
}: {
  section: DraftSection;
  onEdit: () => void;
  onFixItem: (item: ResumeSectionItem) => void;
}) {
  const meta = metaOf(section.kind);
  const unclear = section.items?.filter((item) => item.unclear).length ?? 0;
  const title =
    section.kind === "header" ? meta.label : (section.heading ?? meta.label);
  const lines = section.body.split("\n").filter((line) => line.trim());

  return (
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-2">
        <span className="text-[#5F6B80]" aria-hidden="true">{meta.icon}</span>
        <Eyebrow>{title}</Eyebrow>
        {unclear > 0 ? (
          <span className="flex items-center gap-1.5 rounded-full border border-[#7A5C0E] bg-white px-2 py-1 text-[11px] font-bold leading-3 text-[#7A5C0E]">
            <TriangleAlert className="h-3 w-3" aria-hidden="true" />
            {unclear} unclear
          </span>
        ) : lines.length > 0 ? (
          <DoneDot />
        ) : null}
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${title}`}
          className="ml-auto grid h-8 w-8 cursor-pointer place-items-center rounded-full text-[#566073] transition hover:bg-[#F7F4EC]"
        >
          <PencilLine className="h-[15px] w-[15px]" aria-hidden="true" />
        </button>
      </div>

      {section.items && section.items.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {section.items.map((item, index) =>
            item.unclear ? (
              <button
                key={`${item.text}-${index}`}
                type="button"
                onClick={() => onFixItem(item)}
                className="flex cursor-pointer items-center gap-1.5 rounded-full border border-dashed border-[#E6C79A] bg-white px-3 py-2 text-[13px] font-medium leading-4 text-[#7A5C0E] transition hover:border-[#7A5C0E]"
              >
                {item.text}
                <Pencil className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : (
              <button
                key={`${item.text}-${index}`}
                type="button"
                onClick={() => onFixItem(item)}
                className="cursor-pointer rounded-full bg-[#F7EFD6] px-3 py-2 text-[13px] font-medium leading-4 text-[#0A1931] transition hover:bg-[#F0E4C2]"
              >
                {item.text}
              </button>
            ),
          )}
        </div>
      ) : lines.length > 0 ? (
        <div className="flex flex-col gap-1">
          {lines.slice(0, 12).map((line, index) => (
            <span
              key={index}
              className={`text-[14px] leading-5 ${
                index === 0 ? "font-semibold text-[#0A1931]" : "text-[#3A4761]"
              }`}
            >
              {line}
            </span>
          ))}
          {lines.length > 12 && (
            <button
              type="button"
              onClick={onEdit}
              className="w-fit cursor-pointer text-[13px] font-semibold text-[#5F4DB2]"
            >
              + {lines.length - 12} more lines
            </button>
          )}
        </div>
      ) : (
        <span className="text-[14px] text-[#5F6B80]">Nothing here yet.</span>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * Structured (form) versions
 * ---------------------------------------------------------------------- */
function asManual(parsed: Record<string, unknown>): ManualResume {
  const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

  return {
    full_name: typeof parsed.full_name === "string" ? parsed.full_name : "",
    headline: typeof parsed.headline === "string" ? parsed.headline : null,
    experience: list(parsed.experience),
    education: list(parsed.education),
    skills: list<string>(parsed.skills).filter((skill) => typeof skill === "string"),
  };
}

function StructuredReview({
  version,
  onConfirmed,
  onEdit,
  onStartOver,
}: {
  version: ResumeVersionDetail;
  onConfirmed: (confirmedAt: string) => void;
  onEdit: (resume: ManualResume, resumeVersionId: string) => void;
  onStartOver: () => void;
}) {
  const resume = useMemo(() => asManual(version.parsed), [version.parsed]);
  const [confirmVersion, { isLoading }] = useConfirmResumeVersionMutation();
  const [error, setError] = useState<string | null>(null);
  const edit = () => onEdit(resume, version.resumeVersionId);

  const confirm = async () => {
    setError(null);
    try {
      const confirmed = await confirmVersion(version.resumeVersionId).unwrap();
      onConfirmed(confirmed.confirmedAt);
    } catch (failure) {
      setError(getApiErrorStatusText(failure));
    }
  };

  const editButton = (label: string) => (
    <button
      type="button"
      onClick={edit}
      aria-label={`Edit ${label}`}
      className="ml-auto grid h-8 w-8 cursor-pointer place-items-center rounded-full text-[#566073] transition hover:bg-[#F7F4EC]"
    >
      <PencilLine className="h-[15px] w-[15px]" aria-hidden="true" />
    </button>
  );

  return (
    <div className="flex flex-col gap-5">
      <StepHeader title="Review details" subtitle="Nothing is scored until you confirm." />

      {error && <ErrorNote>{error}</ErrorNote>}

      <div className="flex flex-col gap-3">
        <Card className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-[#5F6B80]" aria-hidden="true" />
            <Eyebrow>Basics</Eyebrow>
            <DoneDot />
            {editButton("basics")}
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-[14px] text-[#5F6B80]">Name</span>
            <span className="text-right text-[14px] font-semibold text-[#0A1931]">{resume.full_name}</span>
          </div>
          {resume.headline && (
            <div className="flex justify-between gap-4">
              <span className="text-[14px] text-[#5F6B80]">About</span>
              <span className="text-right text-[14px] font-semibold text-[#0A1931]">{resume.headline}</span>
            </div>
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2">
            <GraduationCap className="h-4 w-4 text-[#5F6B80]" aria-hidden="true" />
            <Eyebrow>Education</Eyebrow>
            {resume.education.length > 0 && <DoneDot />}
            {editButton("education")}
          </div>
          {resume.education.length === 0 ? (
            <span className="text-[14px] text-[#5F6B80]">Nothing added yet.</span>
          ) : (
            resume.education.map((item, index) => (
              <div key={index} className={`flex flex-col gap-1 ${index > 0 ? "border-t border-[#F7EFD6] pt-4" : ""}`}>
                <span className="text-[15px] font-semibold text-[#0A1931]">{item.qualification}</span>
                <span className="text-[13px] text-[#5F6B80]">
                  {[item.institution, item.completed_year].filter(Boolean).join(" · ")}
                </span>
              </div>
            ))
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-[#5F6B80]" aria-hidden="true" />
            <Eyebrow>Experience &amp; projects</Eyebrow>
            {editButton("experience")}
          </div>
          {resume.experience.length === 0 ? (
            <div className="flex items-center gap-3">
              <span className="flex-1 text-[14px] font-medium text-[#5F6B80]">No experience or projects yet</span>
              <button
                type="button"
                onClick={edit}
                className="flex cursor-pointer items-center gap-1.5 rounded-full bg-[#5F4DB2] px-3.5 py-2 text-[12px] font-semibold text-white"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
                Add
              </button>
            </div>
          ) : (
            resume.experience.map((item, index) => (
              <div key={index} className={`flex flex-col gap-1 ${index > 0 ? "border-t border-[#F7EFD6] pt-4" : ""}`}>
                <span className="text-[15px] font-semibold text-[#0A1931]">{item.title}</span>
                <span className="text-[13px] text-[#5F6B80]">
                  {item.employer} · {item.start_year}
                  {item.end_year ? `–${item.end_year}` : "–now"}
                </span>
              </div>
            ))
          )}
        </Card>

        <Card className="flex flex-col gap-4 p-4">
          <div className="flex items-center gap-2">
            <Wrench className="h-4 w-4 text-[#5F6B80]" aria-hidden="true" />
            <Eyebrow>Skills</Eyebrow>
            {resume.skills.length > 0 && <DoneDot />}
            {editButton("skills")}
          </div>
          {resume.skills.length === 0 ? (
            <span className="text-[14px] text-[#5F6B80]">No skills added yet.</span>
          ) : (
            <div className="flex flex-wrap gap-2">
              {resume.skills.map((skill) => (
                <span key={skill} className="rounded-full bg-[#F7EFD6] px-3 py-2 text-[13px] font-medium text-[#0A1931]">
                  {skill}
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="sticky bottom-0 -mx-1 flex flex-col gap-3 bg-[#FFFCF7] px-1 pb-3.5 pt-4">
        <PillButton onClick={() => void confirm()} isLoading={isLoading} className="w-full py-[18px]">
          Confirm
        </PillButton>
        <div className="flex items-center justify-between gap-3 text-[12px] leading-4 text-[#5F6B80]">
          <span>You can edit any of this later.</span>
          <button
            type="button"
            onClick={onStartOver}
            className="cursor-pointer font-semibold text-[#3A4761] hover:text-[#0A1931]"
          >
            Use a different resume
          </button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Sheets - a bottom sheet on a phone, a centred dialog on a laptop.
 * ---------------------------------------------------------------------- */
function Sheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#0A1931]/35 sm:items-center sm:p-6"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="flex max-h-[90vh] w-full flex-col gap-5 overflow-y-auto rounded-t-[28px] bg-white px-5 pb-5 pt-3 shadow-[0_-8px_40px_-12px_rgba(10,25,49,0.22)] sm:max-w-[520px] sm:rounded-[28px] sm:p-6"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-[#E7E0D4] sm:hidden" aria-hidden="true" />
        <div className="flex items-start gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <span className="text-[20px] font-bold leading-6 tracking-[-0.02em] text-[#0A1931]">{title}</span>
            {subtitle && <span className="text-[13px] leading-[18px] text-[#5F6B80]">{subtitle}</span>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-10 w-10 flex-none cursor-pointer place-items-center rounded-full border border-[#E7E0D4] bg-white"
          >
            <X className="h-4 w-4 text-[#3A4761]" aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function FixItemSheet({
  noun,
  item,
  onClose,
  onRemove,
  onSave,
}: {
  noun: string;
  item: ResumeSectionItem;
  onClose: () => void;
  onRemove: () => void;
  onSave: (text: string) => void;
}) {
  const [value, setValue] = useState(item.suggestion ?? item.text);
  const choices = [item.suggestion, item.text].filter(
    (choice, index, all): choice is string => Boolean(choice) && all.indexOf(choice) === index,
  );
  const trimmed = value.trim();

  return (
    <Sheet
      title={`Fix this ${noun}`}
      subtitle={`We read "${item.text}" from your resume`}
      onClose={onClose}
    >
      <input
        aria-label={`Corrected ${noun}`}
        autoFocus
        value={value}
        maxLength={200}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && trimmed) onSave(trimmed);
        }}
        className={`${fieldClass} border-[#0A1931]`}
      />

      {choices.length > 1 || item.suggestion ? (
        <div className="flex flex-col gap-2">
          <Eyebrow>Did you mean</Eyebrow>
          <div className="flex flex-wrap gap-2">
            {choices.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => setValue(choice)}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3.5 py-2.5 text-[13px] leading-4 ${
                  value === choice
                    ? "border border-[#DDD6C7] bg-white font-semibold text-[#0A1931]"
                    : "bg-[#F7EFD6] font-medium text-[#0A1931]"
                }`}
              >
                {value === choice && <Check className="h-3 w-3" aria-hidden="true" />}
                {choice}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex gap-3">
        <PillButton variant="secondary" onClick={onRemove} className="w-24 flex-none py-4 text-[15px]">
          Remove
        </PillButton>
        <PillButton onClick={() => onSave(trimmed)} disabled={!trimmed} className="flex-1 py-4 text-[15px]">
          Save {noun}
        </PillButton>
      </div>
    </Sheet>
  );
}

function EditSectionSheet({
  title,
  body,
  onClose,
  onSave,
}: {
  title: string;
  body: string;
  onClose: () => void;
  onSave: (body: string) => void;
}) {
  const [value, setValue] = useState(body);

  return (
    <Sheet title={title} subtitle="Write it the way you want an employer to read it." onClose={onClose}>
      <textarea
        aria-label={title}
        autoFocus
        rows={10}
        value={value}
        maxLength={20000}
        onChange={(event) => setValue(event.target.value)}
        className={`${fieldClass} ${fieldBorder(false)} min-h-[220px] resize-y text-[15px] font-normal leading-6`}
      />
      <div className="flex gap-3">
        <PillButton variant="secondary" onClick={onClose} className="w-28 flex-none py-4 text-[15px]">
          Cancel
        </PillButton>
        <PillButton onClick={() => onSave(value.trim())} className="flex-1 py-4 text-[15px]">
          Save
        </PillButton>
      </div>
    </Sheet>
  );
}
