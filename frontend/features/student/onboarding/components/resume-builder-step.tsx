"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Download, Loader2, Plus, RotateCcw, Save, Send, Trash2 } from "lucide-react";

import type { StructuredResume } from "@/components/resume/structured-resume";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { showErrorFeedback, showSuccessFeedback } from "@/lib/feedback/success-feedback";
import {
  useDownloadBuilderMutation,
  useGetBuilderDraftQuery,
  useGetBuilderTemplatesQuery,
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

const input =
  "w-full rounded-lg border border-[#DDD6C7] bg-white px-3 py-2 text-[14px] text-[#0A1931] outline-none transition placeholder:text-[#9AA1AE] focus:border-[#5F4DB2] focus:ring-2 focus:ring-[#5F4DB2]/15";

const blank = {
  experience: (): Experience => ({ job_title: "", company: "", location: "", employment_type: "", start_date: "", end_date: "", is_current: false, description: "", highlights: [], skills_used: [] }),
  education: (): Education => ({ qualification: "", field_of_study: "", institution: "", location: "", start_date: "", end_date: "", grade: "", description: "" }),
  project: (): Project => ({ name: "", role: "", description: "", technologies: [], url: "", start_date: "", end_date: "" }),
  certification: (): Certification => ({ name: "", issuer: "", issue_date: "", expiry_date: "", credential_id: "", url: "" }),
  language: (): Language => ({ name: "", proficiency: "" }),
};

/**
 * The resume builder: a form on the left, the rendered resume on the right.
 * The preview is the last *saved* draft, so it moves only when Save succeeds.
 */
export function ResumeBuilderStep({
  onBack,
  onSubmitted,
}: {
  onBack: () => void;
  onSubmitted: (result: BuilderPush) => void;
}) {
  const draftQuery = useGetBuilderDraftQuery();
  const templates = useGetBuilderTemplatesQuery();
  const [saveDraft, saveState] = useSaveBuilderDraftMutation();
  const [resetDraft, resetState] = useResetBuilderDraftMutation();
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
  const loaded = useRef(false);

  const snapshot = (resume: StructuredResume, key: BuilderTemplateKey) => JSON.stringify([key, resume]);
  const dirty = content !== null && snapshot(content, template) !== savedSnapshot;
  const busy = saveState.isLoading || pushState.isLoading || downloadState.isLoading || resetState.isLoading;

  const draw = async (resume: StructuredResume, key: BuilderTemplateKey) => {
    try {
      const result = await preview({ template_key: key, content: resume }).unwrap();
      setPages({ mime: result.mime, pages: result.pages });
    } catch (failure) {
      showErrorFeedback(getApiErrorMessage(failure, "The preview could not be drawn."));
    }
  };

  // First load: show the draft (or the first draft from onboarding) and draw it once.
  useEffect(() => {
    if (!draftQuery.data || loaded.current) return;
    loaded.current = true;
    const { content: initial, template_key, saved } = draftQuery.data;
    setContent(initial);
    setTemplate(template_key);
    // An unsaved first draft counts as changed, so the candidate is nudged to save it.
    setSavedSnapshot(saved ? snapshot(initial, template_key) : "");
    void draw(initial, template_key);
  }, [draftQuery.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (): Promise<boolean> => {
    if (!content) return false;
    setError("");
    try {
      const result = await saveDraft({ template_key: template, content }).unwrap();
      setSavedSnapshot(snapshot(result.content, result.template_key));
      setContent(result.content);
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
    if (await save()) showSuccessFeedback("Resume saved.");
  };

  const needsSave = dirty || savedSnapshot === "";

  const onDownload = async () => {
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
    if (needsSave && !(await save())) return;
    try {
      onSubmitted(await push().unwrap());
    } catch (failure) {
      const message = getApiErrorMessage(failure, "Your resume could not be submitted. Add your name and at least one job, qualification or skill.");
      setError(message);
      showErrorFeedback(message);
    }
  };

  const onReset = async () => {
    if (!window.confirm("Start again from your onboarding answers? Your edits will be replaced.")) return;
    try {
      const result = await resetDraft().unwrap();
      setContent(result.content);
      setTemplate(result.template_key);
      setSavedSnapshot(snapshot(result.content, result.template_key));
      setEditorKey((key) => key + 1);
      await draw(result.content, result.template_key);
    } catch (failure) {
      showErrorFeedback(getApiErrorMessage(failure, "The resume could not be reset."));
    }
  };

  const patch = (changes: Partial<StructuredResume>) => setContent((current) => (current ? { ...current, ...changes } : current));
  const contacts = useMemo(() => content?.contacts, [content]);

  if (draftQuery.isError)
    return (
      <div className="mx-auto max-w-lg p-8 text-center" role="alert">
        <p className="text-[#3A4761]">We could not load your resume details.</p>
        <button type="button" className="mt-4 rounded-full bg-[#5F4DB2] px-5 py-2 font-semibold text-white" onClick={() => void draftQuery.refetch()}>Try again</button>
        <div className="mt-3"><button type="button" className="text-sm underline" onClick={onBack}>Back</button></div>
      </div>
    );

  if (!content || !contacts)
    return <div className="grid min-h-[60dvh] place-items-center text-[#5F4DB2]"><Loader2 className="h-6 w-6 animate-spin" aria-label="Loading" /></div>;

  return (
    <div className="flex h-dvh flex-col bg-[#FFFCF7] text-[#0A1931]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#F0EBDF] bg-white px-4 py-3">
        <button type="button" onClick={onBack} disabled={busy} className="flex items-center gap-2 rounded-full border border-[#DDD6C7] px-4 py-2 text-sm font-semibold disabled:opacity-50">
          <ArrowLeft size={16} aria-hidden="true" /> Back
        </button>
        <div className="mr-auto min-w-0">
          <h1 className="truncate text-[16px] font-bold leading-5">Generate your resume</h1>
          <p className="text-[12px] text-[#5F6B80]">{needsSave ? "Unsaved changes: the preview shows your last save." : "Saved. The preview matches your resume."}</p>
        </div>
        <button type="button" onClick={() => void onSave()} disabled={busy || !needsSave} className="flex items-center gap-2 rounded-full border border-[#5F4DB2] px-4 py-2 text-sm font-semibold text-[#5F4DB2] disabled:opacity-50">
          {saveState.isLoading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Save
        </button>
        <button type="button" onClick={() => void onDownload()} disabled={busy} className="flex items-center gap-2 rounded-full border border-[#DDD6C7] px-4 py-2 text-sm font-semibold disabled:opacity-50">
          {downloadState.isLoading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Download size={16} aria-hidden="true" />} Download
        </button>
        <button type="button" onClick={() => void onSubmit()} disabled={busy} className="flex items-center gap-2 rounded-full bg-[#5F4DB2] px-5 py-2 text-sm font-semibold text-white hover:bg-[#4A3E8F] disabled:opacity-60">
          {pushState.isLoading ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Send size={16} aria-hidden="true" />} Submit
        </button>
      </header>

      <div className="flex border-b border-[#F0EBDF] lg:hidden" role="tablist">
        {(["edit", "preview"] as const).map((tab) => (
          <button key={tab} type="button" role="tab" aria-selected={mobileTab === tab} onClick={() => setMobileTab(tab)}
            className={`flex-1 py-2.5 text-sm font-semibold capitalize ${mobileTab === tab ? "border-b-2 border-[#5F4DB2] text-[#5F4DB2]" : "text-[#5F6B80]"}`}>{tab}</button>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 lg:grid-cols-2">
        <div className={`min-h-0 overflow-y-auto px-4 py-5 sm:px-6 ${mobileTab === "edit" ? "" : "hidden lg:block"}`}>
          <div key={editorKey} className="mx-auto flex max-w-xl flex-col gap-6">
            {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
            <p className="text-[13px] leading-5 text-[#3A4761]">
              We filled this in from your onboarding answers. Correct anything, add your projects, then press Save to update the preview.
            </p>

            <Section title="Template" action={<button type="button" onClick={() => void onReset()} disabled={busy} className="flex items-center gap-1 text-xs text-[#5F6B80] underline disabled:opacity-50"><RotateCcw size={12} aria-hidden="true" /> Refill from my answers</button>}>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Resume template">
                {(templates.data?.templates ?? []).map((item) => (
                  <button key={item.key} type="button" role="radio" aria-checked={template === item.key} onClick={() => setTemplate(item.key)}
                    className={`rounded-xl border p-3 text-left ${template === item.key ? "border-[#5F4DB2] bg-[#F1EAF7]" : "border-[#DDD6C7] bg-white hover:border-[#5F4DB2]"}`}>
                    <span className="block text-sm font-semibold">{item.name}</span>
                    <span className="mt-0.5 block text-[11px] leading-4 text-[#5F6B80]">{item.description}</span>
                  </button>
                ))}
              </div>
            </Section>

            <Section title="About you">
              <Text label="Full name" value={content.full_name} onChange={(full_name) => patch({ full_name })} />
              <Text label="Headline" value={content.headline} onChange={(headline) => patch({ headline })} placeholder="e.g. Data Analyst" />
              <Text label="City" value={content.location} onChange={(location) => patch({ location })} />
              <Text label="Summary" value={content.summary} onChange={(summary) => patch({ summary })} multiline placeholder="Two or three lines about your work." />
            </Section>

            <Section title="Contact and links">
              <Text label="Email" value={contacts.email} onChange={(email) => patch({ contacts: { ...contacts, email } })} />
              <Text label="Phone" value={contacts.phone} onChange={(phone) => patch({ contacts: { ...contacts, phone } })} />
              <Text label="LinkedIn" value={contacts.linkedin} onChange={(linkedin) => patch({ contacts: { ...contacts, linkedin } })} />
              <Text label="GitHub" value={contacts.github} onChange={(github) => patch({ contacts: { ...contacts, github } })} />
              <Text label="Website" value={contacts.website} onChange={(website) => patch({ contacts: { ...contacts, website } })} />
            </Section>

            <Section title="Experience">
              <Repeater items={content.experience} blank={blank.experience} onChange={(experience) => patch({ experience })} addLabel="Add experience" empty="Freshers can leave this empty."
                render={(item, set) => (<>
                  <Row><Text label="Job title" value={item.job_title} onChange={(job_title) => set({ job_title })} /><Text label="Company" value={item.company} onChange={(company) => set({ company })} /></Row>
                  <Row><Text label="Start (YYYY-MM)" value={item.start_date} onChange={(start_date) => set({ start_date })} placeholder="2022-07" />
                    <Text label="End (YYYY-MM)" value={item.is_current ? "" : item.end_date} disabled={item.is_current} onChange={(end_date) => set({ end_date })} placeholder="2024-03" /></Row>
                  <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={item.is_current} onChange={(event) => set({ is_current: event.target.checked, end_date: event.target.checked ? "" : item.end_date })} /> I work here now</label>
                  <Text label="Location" value={item.location} onChange={(location) => set({ location })} />
                  <Text label="What you did" value={item.description} onChange={(description) => set({ description })} multiline />
                  <ListText label="Highlights (one per line)" value={item.highlights} onChange={(highlights) => set({ highlights })} lines />
                </>)} />
            </Section>

            <Section title="Education">
              <Repeater items={content.education} blank={blank.education} onChange={(education) => patch({ education })} addLabel="Add education"
                render={(item, set) => (<>
                  <Row><Text label="Qualification" value={item.qualification} onChange={(qualification) => set({ qualification })} placeholder="B.Com" /><Text label="Field of study" value={item.field_of_study} onChange={(field_of_study) => set({ field_of_study })} /></Row>
                  <Text label="Institution" value={item.institution} onChange={(institution) => set({ institution })} />
                  <Row><Text label="Start (YYYY)" value={item.start_date} onChange={(start_date) => set({ start_date })} /><Text label="End (YYYY)" value={item.end_date} onChange={(end_date) => set({ end_date })} /></Row>
                  <Text label="Grade" value={item.grade} onChange={(grade) => set({ grade })} placeholder="8.4 CGPA" />
                </>)} />
            </Section>

            <Section title="Skills">
              <ListText label="Skills (comma separated)" value={content.skills} onChange={(skills) => patch({ skills })} />
            </Section>

            <Section title="Projects">
              <Repeater items={content.projects} blank={blank.project} onChange={(projects) => patch({ projects })} addLabel="Add a project" empty="Add projects to make your resume stronger."
                render={(item, set) => (<>
                  <Row><Text label="Project name" value={item.name} onChange={(name) => set({ name })} /><Text label="Your role" value={item.role} onChange={(role) => set({ role })} /></Row>
                  <Text label="Description" value={item.description} onChange={(description) => set({ description })} multiline placeholder="What it does and what you built." />
                  <ListText label="Technologies (comma separated)" value={item.technologies} onChange={(technologies) => set({ technologies })} />
                  <Text label="Link" value={item.url} onChange={(url) => set({ url })} />
                </>)} />
            </Section>

            <Section title="Certifications">
              <Repeater items={content.certifications} blank={blank.certification} onChange={(certifications) => patch({ certifications })} addLabel="Add certification"
                render={(item, set) => (<>
                  <Row><Text label="Name" value={item.name} onChange={(name) => set({ name })} /><Text label="Issued by" value={item.issuer} onChange={(issuer) => set({ issuer })} /></Row>
                  <Text label="Issued (YYYY-MM)" value={item.issue_date} onChange={(issue_date) => set({ issue_date })} />
                </>)} />
            </Section>

            <Section title="Languages">
              <Repeater items={content.languages} blank={blank.language} onChange={(languages) => patch({ languages })} addLabel="Add language"
                render={(item, set) => (
                  <Row><Text label="Language" value={item.name} onChange={(name) => set({ name })} /><Text label="Proficiency" value={item.proficiency} onChange={(proficiency) => set({ proficiency })} placeholder="Native" /></Row>
                )} />
            </Section>

            <Section title="Achievements and interests">
              <ListText label="Achievements (one per line)" value={content.achievements} onChange={(achievements) => patch({ achievements })} lines />
              <ListText label="Interests (comma separated)" value={content.interests} onChange={(interests) => patch({ interests })} />
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
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-[#E7E0D4] bg-white p-4">
      <div className="flex items-center justify-between gap-3"><h2 className="text-[15px] font-bold">{title}</h2>{action}</div>
      {children}
    </section>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div className="grid gap-3 sm:grid-cols-2">{children}</div>;

function Text({ label, value, onChange, multiline, placeholder, disabled }: {
  label: string; value: string; onChange: (value: string) => void; multiline?: boolean; placeholder?: string; disabled?: boolean;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-[12px] font-semibold text-[#3A4761]">{label}</span>
      {multiline
        ? <textarea className={`${input} min-h-20 resize-y`} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        : <input className={`${input} disabled:bg-[#F7F4EC]`} value={value} disabled={disabled} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}
    </label>
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

function Repeater<T>({ items, blank: makeBlank, onChange, render, addLabel, empty }: {
  items: T[]; blank: () => T; onChange: (items: T[]) => void; addLabel: string; empty?: string;
  render: (item: T, set: (changes: Partial<T>) => void) => ReactNode;
}) {
  // Rows have no id, so keys come from a parallel list that follows adds and removals.
  const keys = useRef<number[]>([]);
  const counter = useRef(0);
  while (keys.current.length < items.length) keys.current.push(counter.current++);
  keys.current.length = items.length;
  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && empty && <p className="text-[13px] text-[#5F6B80]">{empty}</p>}
      {items.map((item, index) => (
        <div key={keys.current[index]} className="flex flex-col gap-3 rounded-xl border border-[#EFE9DB] bg-[#FFFCF7] p-3">
          {render(item, (changes) => onChange(items.map((current, position) => (position === index ? { ...current, ...changes } : current))))}
          <button type="button" onClick={() => { keys.current.splice(index, 1); onChange(items.filter((_, position) => position !== index)); }}
            className="flex items-center gap-1 self-end text-xs text-[#9A3B42] underline"><Trash2 size={12} aria-hidden="true" /> Remove</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...items, makeBlank()])}
        className="flex items-center gap-2 self-start rounded-full border border-dashed border-[#5F4DB2] px-4 py-2 text-sm font-semibold text-[#5F4DB2]"><Plus size={14} aria-hidden="true" /> {addLabel}</button>
    </div>
  );
}
