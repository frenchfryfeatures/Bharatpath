"use client";

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleOff,
  Clock3,
  FileVideo,
  Pencil,
  Play,
  Plus,
  Upload,
  X,
} from "lucide-react";

import { usePageHeader } from "@/components/layout/header-context";
import { ErrorState, Modal, SelectDropdown } from "@/components/ui";
import { Skeleton } from "@/components/common/loading";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { showFormError } from "@/lib/feedback/form-error";
import { showAdminFeedback } from "@/store/admin";
import {
  type AdminCourse,
  type AdminCourseLesson,
  type AdminCourseModule,
  useConfirmAdminLessonUploadMutation,
  useCreateAdminCourseLessonMutation,
  useCreateAdminCourseModuleMutation,
  useGetAdminCoursesQuery,
  useIssueAdminLessonUploadMutation,
  usePublishAdminCourseMutation,
  useUpdateAdminCourseLessonMutation,
  useUpdateAdminCourseModuleMutation,
} from "@/store/api/admin-api";
import { useAppDispatch } from "@/store/hooks";

import { FormField, INPUT_HEIGHT, a11y, inputClass } from "../shared/form";

type ModuleDraft = { title: string; sortOrder: string };
type LessonDraft = {
  title: string;
  description: string;
  sortOrder: string;
  media: "YOUTUBE" | "UPLOAD";
  youtubeUrl: string;
  file: File | null;
};

const emptyModule = (): ModuleDraft => ({ title: "", sortOrder: "0" });
const emptyLesson = (): LessonDraft => ({
  title: "",
  description: "",
  sortOrder: "0",
  media: "YOUTUBE",
  youtubeUrl: "",
  file: null,
});

function lessonDraft(lesson: AdminCourseLesson): LessonDraft {
  return {
    title: lesson.title,
    description: lesson.description ?? "",
    sortOrder: String(lesson.sort_order),
    media: lesson.media_kind,
    youtubeUrl: lesson.youtube_video_id
      ? `https://www.youtube.com/watch?v=${lesson.youtube_video_id}`
      : "",
    file: null,
  };
}

function money(minor: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: minor % 100 === 0 ? 0 : 2,
  }).format(minor / 100);
}

function durationLabel(seconds: number) {
  const minutes = Math.ceil(seconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes} min`;
}

function editorError(error: unknown) {
  return getApiErrorMessage(error, "The course could not be updated. Please try again.");
}

function isYouTubeVideoUrl(value: string) {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol)) return false;
    if (!["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "www.youtube-nocookie.com"].includes(url.hostname)) return false;
    const parts = url.pathname.split("/").filter(Boolean);
    const videoId = url.hostname === "youtu.be"
      ? parts[0]
      : parts[0] === "watch"
        ? url.searchParams.get("v")
        : ["embed", "shorts", "live", "v"].includes(parts[0])
          ? parts[1]
          : null;
    return /^[A-Za-z0-9_-]{11}$/.test(videoId ?? "");
  } catch {
    return false;
  }
}

export function CoursesPage() {
  usePageHeader("Courses", "Build course modules and lessons, upload videos, and control publishing");
  const { data: courses = [], error, isLoading, isFetching, refetch } = useGetAdminCoursesQuery();
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [moduleEditor, setModuleEditor] = useState<AdminCourseModule | "new" | null>(null);
  const [lessonEditor, setLessonEditor] = useState<{ moduleId: string; lesson: AdminCourseLesson | null } | null>(null);
  const [publishTarget, setPublishTarget] = useState<AdminCourse | null>(null);

  const course = courses.find((item) => item.code === selectedCode) ?? courses[0];
  const totals = useMemo(() => {
    const modules = course?.modules.filter((item) => item.active) ?? [];
    const lessons = modules.flatMap((item) => item.lessons).filter((item) => item.active);
    return {
      modules: modules.length,
      lessons: lessons.length,
      ready: lessons.filter((item) => item.media_ready).length,
      seconds: lessons.reduce((sum, item) => sum + item.duration_seconds, 0),
    };
  }, [course]);

  if (isLoading) return <CoursesSkeleton />;
  if (error) return <ErrorState error={error} fallback="Courses could not be loaded." onRetry={() => refetch()} className="mt-4" />;
  if (!course) {
    return (
      <div className="mt-4 rounded-xl border border-dashed border-[#dfe2e8] bg-white px-6 py-14 text-center">
        <BookOpen className="mx-auto h-8 w-8 text-[#98a0ae]" />
        <h2 className="mt-3 text-[14px] font-semibold text-[#172033]">No course catalogue configured</h2>
        <p className="mx-auto mt-1 max-w-md text-[12px] leading-5 text-[#7b8494]">
          Course records are supplied by the platform catalogue. Once one is configured, you can build its modules and lessons here.
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:w-[320px]">
          <SelectDropdown
            value={course.code}
            onChange={(value) => setSelectedCode(value)}
            options={courses.map((item) => ({ value: item.code, label: item.title }))}
            ariaLabel="Select a course"
            className="h-10 rounded-lg text-[12px]"
          />
        </div>
        <button
          type="button"
          onClick={() => setModuleEditor("new")}
          className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#151b2b] px-4 text-[12px] font-semibold text-white hover:bg-[#20283d]"
        >
          <Plus size={16} /> Add module
        </button>
      </div>

      <section className="rounded-xl border border-[#e3e6eb] bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,0.03)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-semibold text-[#151b2b]">{course.title}</h2>
              <StatusPill active={course.published} activeText="Published" inactiveText="Draft" />
            </div>
            <p className="mt-1 text-[11px] text-[#7b8494]">{course.code} · Version {course.version} · {money(course.price_minor)}</p>
          </div>
          <button
            type="button"
            onClick={() => setPublishTarget(course)}
            className={`inline-flex h-9 cursor-pointer items-center justify-center rounded-lg border px-4 text-[12px] font-semibold ${course.published ? "border-[#f1c8c8] text-[#a83d44] hover:bg-[#fff6f6]" : "border-[#c8d8f0] text-[#315c9f] hover:bg-[#f4f7fb]"}`}
          >
            {course.published ? "Unpublish course" : "Publish course"}
          </button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Metric label="Active modules" value={totals.modules} />
          <Metric label="Active lessons" value={totals.lessons} />
          <Metric label="Videos ready" value={`${totals.ready}/${totals.lessons}`} />
          <Metric label="Total duration" value={durationLabel(totals.seconds)} />
        </div>
      </section>

      <div className="space-y-3">
        {course.modules.length ? course.modules.map((module) => (
          <ModuleCard
            key={module.id}
            module={module}
            onEdit={() => setModuleEditor(module)}
            onAddLesson={() => setLessonEditor({ moduleId: module.id, lesson: null })}
            onEditLesson={(lesson) => setLessonEditor({ moduleId: module.id, lesson })}
          />
        )) : (
          <div className="rounded-xl border border-dashed border-[#dfe2e8] bg-white px-6 py-12 text-center">
            <p className="text-[13px] font-semibold text-[#344054]">Start by adding the first module</p>
            <p className="mt-1 text-[11px] text-[#7b8494]">A course needs at least one playable lesson before it can be published.</p>
          </div>
        )}
      </div>

      {moduleEditor ? (
        <ModuleEditor
          course={course}
          module={moduleEditor === "new" ? null : moduleEditor}
          onClose={() => setModuleEditor(null)}
          onError={(error) => showFormError(editorError(error), { portal: "admin" })}
        />
      ) : null}
      {lessonEditor ? (
        <LessonEditor
          moduleId={lessonEditor.moduleId}
          lesson={lessonEditor.lesson}
          onClose={() => setLessonEditor(null)}
          onError={(error) => showFormError(editorError(error), { portal: "admin" })}
        />
      ) : null}
      {publishTarget ? (
        <PublishDialog
          course={publishTarget}
          onClose={() => setPublishTarget(null)}
          onError={(error) => showFormError(editorError(error), { portal: "admin" })}
        />
      ) : null}
      {isFetching ? <span className="sr-only" role="status">Refreshing courses</span> : null}
    </div>
  );
}

function ModuleCard({ module, onEdit, onAddLesson, onEditLesson }: {
  module: AdminCourseModule;
  onEdit: () => void;
  onAddLesson: () => void;
  onEditLesson: (lesson: AdminCourseLesson) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`overflow-hidden rounded-xl border bg-white ${module.active ? "border-[#e3e6eb]" : "border-[#e3e6eb] opacity-65"}`}>
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-[#687182] hover:bg-[#f5f6f8]">
          <ChevronDown size={17} className={`transition-transform ${open ? "" : "-rotate-90"}`} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[13px] font-semibold text-[#172033]">{module.title}</h3>
            {!module.active ? <StatusPill active={false} activeText="" inactiveText="Inactive" /> : null}
          </div>
          <p className="mt-0.5 text-[11px] text-[#7b8494]">{module.lessons.length} lesson{module.lessons.length === 1 ? "" : "s"} · Order {module.sort_order}</p>
        </div>
        <button type="button" onClick={onEdit} aria-label={`Edit ${module.title}`} className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-[#e2e5eb] text-[#687182] hover:bg-[#f8f9fb]"><Pencil size={14} /></button>
        <button type="button" onClick={onAddLesson} className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-[#dfe2e8] px-3 text-[11px] font-semibold text-[#344054] hover:bg-[#f8f9fb]"><Plus size={14} /> Lesson</button>
      </div>
      {open ? (
        <div className="border-t border-[#edf0f3]">
          {module.lessons.length ? module.lessons.map((lesson, index) => (
            <button key={lesson.id} type="button" onClick={() => onEditLesson(lesson)} className={`flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left hover:bg-[#fafbfc] ${index ? "border-t border-[#f0f1f3]" : ""}`}>
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${lesson.media_kind === "YOUTUBE" ? "bg-[#fff0f0] text-[#c43c42]" : "bg-[#eef3fa] text-[#315c9f]"}`}>
                {lesson.media_kind === "YOUTUBE" ? <Play size={16} /> : <FileVideo size={16} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold text-[#344054]">{lesson.title}</span>
                <span className="mt-0.5 flex items-center gap-1 text-[10px] text-[#7b8494]"><Clock3 size={11} /> {durationLabel(lesson.duration_seconds)} · Order {lesson.sort_order}</span>
              </span>
              {!lesson.active ? <StatusPill active={false} activeText="" inactiveText="Inactive" /> : lesson.media_ready ? <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#2f7b4b]"><CheckCircle2 size={13} /> Ready</span> : <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#9a6b18]"><Upload size={13} /> Upload needed</span>}
              <Pencil size={13} className="text-[#98a0ae]" />
            </button>
          )) : <p className="px-5 py-5 text-center text-[11px] text-[#7b8494]">No lessons in this module yet.</p>}
        </div>
      ) : null}
    </section>
  );
}

function ModuleEditor({ course, module, onClose, onError }: { course: AdminCourse; module: AdminCourseModule | null; onClose: () => void; onError: (error: unknown) => void }) {
  const dispatch = useAppDispatch();
  const [draft, setDraft] = useState<ModuleDraft>(module ? { title: module.title, sortOrder: String(module.sort_order) } : emptyModule());
  const [fieldError, setFieldError] = useState<{ field: "title" | "sortOrder"; message: string } | null>(null);
  const [create, createState] = useCreateAdminCourseModuleMutation();
  const [update, updateState] = useUpdateAdminCourseModuleMutation();
  const saving = createState.isLoading || updateState.isLoading;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const title = draft.title.trim();
    const order = Number(draft.sortOrder);
    if (!title || title.length > 200) {
      setFieldError({ field: "title", message: !title ? "Enter a module title." : "Use 200 characters or fewer." });
      showFormError("Check the highlighted module field.", { portal: "admin", container: event.currentTarget });
      return;
    }
    if (!draft.sortOrder.trim() || !Number.isInteger(order) || order < 0 || order > 10_000) {
      setFieldError({ field: "sortOrder", message: "Order must be a whole number from 0 to 10,000." });
      showFormError("Check the highlighted module field.", { portal: "admin", container: event.currentTarget });
      return;
    }
    try {
      if (module) await update({ moduleId: module.id, body: { title, sort_order: order } }).unwrap();
      else await create({ code: course.code, body: { title, sort_order: order } }).unwrap();
      dispatch(showAdminFeedback(module ? "Module updated." : "Module added."));
      onClose();
    } catch (error) { onError(error); }
  }

  async function toggleActive() {
    if (!module) return;
    try {
      await update({ moduleId: module.id, body: { active: !module.active } }).unwrap();
      dispatch(showAdminFeedback(module.active ? "Module deactivated." : "Module activated."));
      onClose();
    } catch (error) { onError(error); }
  }

  return (
    <CourseDrawer title={module ? "Edit module" : "Add module"} description={`Organise lessons within ${course.title}.`} onClose={onClose} closeDisabled={saving}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormField id="module-title" label="Module title" error={fieldError?.field === "title" ? fieldError.message : undefined}>
          <input {...a11y("module-title", fieldError?.field === "title" ? fieldError.message : undefined)} value={draft.title} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setFieldError(null); }} maxLength={200} className={inputClass(fieldError?.field === "title", INPUT_HEIGHT)} placeholder="e.g. Getting started" autoFocus />
        </FormField>
        <FormField id="module-order" label="Display order" error={fieldError?.field === "sortOrder" ? fieldError.message : undefined} hint="Lower numbers appear first.">
          <input {...a11y("module-order", fieldError?.field === "sortOrder" ? fieldError.message : undefined)} type="number" min={0} max={10000} value={draft.sortOrder} onChange={(e) => { setDraft({ ...draft, sortOrder: e.target.value }); setFieldError(null); }} className={inputClass(fieldError?.field === "sortOrder", INPUT_HEIGHT)} />
        </FormField>
        <div className="flex items-center justify-between gap-3 border-t border-[#edf0f3] pt-4">
          {module ? <button type="button" onClick={toggleActive} disabled={saving} className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-[#a83d44] disabled:opacity-50"><CircleOff size={14} /> {module.active ? "Deactivate" : "Activate"} module</button> : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="h-9 cursor-pointer rounded-lg border border-[#dfe2e8] px-4 text-[12px] font-semibold text-[#344054]">Cancel</button>
            <button type="submit" disabled={saving} className="h-9 cursor-pointer rounded-lg bg-[#151b2b] px-4 text-[12px] font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : module ? "Save changes" : "Add module"}</button>
          </div>
        </div>
      </form>
    </CourseDrawer>
  );
}

function LessonEditor({ moduleId, lesson, onClose, onError }: { moduleId: string; lesson: AdminCourseLesson | null; onClose: () => void; onError: (error: unknown) => void }) {
  const dispatch = useAppDispatch();
  const [draft, setDraft] = useState<LessonDraft>(lesson ? lessonDraft(lesson) : emptyLesson());
  type LessonField = "title" | "description" | "sortOrder" | "youtubeUrl" | "file";
  const [fieldError, setFieldError] = useState<{ field: LessonField; message: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState<string | null>(null);
  const [create, createState] = useCreateAdminCourseLessonMutation();
  const [update, updateState] = useUpdateAdminCourseLessonMutation();
  const [issueUpload, issueState] = useIssueAdminLessonUploadMutation();
  const [confirmUpload, confirmState] = useConfirmAdminLessonUploadMutation();
  const saving = createState.isLoading || updateState.isLoading || issueState.isLoading || confirmState.isLoading || Boolean(uploadProgress);

  async function uploadVideo(lessonId: string, file: File) {
    setUploadProgress("Preparing upload…");
    const ticket = await issueUpload(lessonId).unwrap();
    if (!ticket.accepted_types.includes(file.type)) throw new Error(`Choose one of: ${ticket.accepted_types.join(", ")}.`);
    if (file.size > ticket.max_bytes) throw new Error(`The video must be smaller than ${Math.floor(ticket.max_bytes / 1024 / 1024)} MB.`);
    setUploadProgress("Uploading video…");
    const response = await fetch(ticket.url, { method: ticket.method, body: file, headers: { "Content-Type": file.type } });
    if (!response.ok) throw new Error("The video upload did not finish. Please try again.");
    setUploadProgress("Checking video…");
    await confirmUpload(lessonId).unwrap();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setFieldError(null);
    const title = draft.title.trim();
    const description = draft.description.trim();
    const order = Number(draft.sortOrder);
    const fail = (field: LessonField, message: string) => {
      setFieldError({ field, message });
      showFormError("Check the highlighted lesson field.", { portal: "admin", container: form });
    };
    if (!title) return fail("title", "Enter a lesson title.");
    if (title.length > 200) return fail("title", "The lesson title must be 200 characters or fewer.");
    if (description.length > 2000) return fail("description", "The description must be 2,000 characters or fewer.");
    if (!draft.sortOrder.trim() || !Number.isInteger(order) || order < 0 || order > 10_000) return fail("sortOrder", "Order must be a whole number from 0 to 10,000.");
    if (draft.media === "YOUTUBE" && !draft.youtubeUrl.trim()) return fail("youtubeUrl", "Enter a YouTube video URL.");
    if (draft.media === "YOUTUBE" && !isYouTubeVideoUrl(draft.youtubeUrl)) return fail("youtubeUrl", "Enter a valid YouTube video URL.");
    if (draft.media === "UPLOAD" && (!lesson || lesson.media_kind !== "UPLOAD") && !draft.file) return fail("file", "Choose an MP4 or WebM video to upload.");
    if (draft.media === "UPLOAD" && draft.file && !["video/mp4", "video/webm"].includes(draft.file.type)) return fail("file", "Choose an MP4 or WebM video.");
    try {
      let lessonId = lesson?.id;
      const body = { title, description: description || null, sort_order: order };
      if (lesson) {
        await update({ lessonId: lesson.id, body: { ...body, ...(draft.media === "YOUTUBE" ? { youtube_url: draft.youtubeUrl.trim() } : {}) } }).unwrap();
      } else {
        const created = await create({ moduleId, body: { ...body, youtube_url: draft.media === "YOUTUBE" ? draft.youtubeUrl.trim() : null } }).unwrap();
        lessonId = created.id;
      }
      if (draft.media === "UPLOAD" && draft.file && lessonId) await uploadVideo(lessonId, draft.file);
      dispatch(showAdminFeedback(lesson ? "Lesson updated." : "Lesson added."));
      onClose();
    } catch (error) {
      setUploadProgress(null);
      if (error instanceof Error && draft.media === "UPLOAD") {
        setFieldError({ field: "file", message: error.message });
        showFormError(error.message, { portal: "admin", container: form, fieldId: "lesson-file" });
      } else onError(error);
    }
  }

  async function toggleActive() {
    if (!lesson) return;
    try {
      await update({ lessonId: lesson.id, body: { active: !lesson.active } }).unwrap();
      dispatch(showAdminFeedback(lesson.active ? "Lesson deactivated." : "Lesson activated."));
      onClose();
    } catch (error) { onError(error); }
  }

  return (
    <CourseDrawer title={lesson ? "Edit lesson" : "Add lesson"} description="Add a YouTube link or upload an MP4/WebM video." onClose={onClose} closeDisabled={saving} wide>
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormField id="lesson-title" label="Lesson title" error={fieldError?.field === "title" ? fieldError.message : undefined}>
          <input {...a11y("lesson-title", fieldError?.field === "title" ? fieldError.message : undefined)} value={draft.title} onChange={(e) => { setDraft({ ...draft, title: e.target.value }); setFieldError(null); }} maxLength={200} className={inputClass(fieldError?.field === "title", INPUT_HEIGHT)} placeholder="e.g. Writing a strong profile" autoFocus />
        </FormField>
        <FormField id="lesson-description" label="Description" error={fieldError?.field === "description" ? fieldError.message : undefined} hint={`${draft.description.length}/2,000 characters`}>
          <textarea {...a11y("lesson-description", fieldError?.field === "description" ? fieldError.message : undefined)} value={draft.description} onChange={(e) => { setDraft({ ...draft, description: e.target.value }); setFieldError(null); }} maxLength={2000} rows={3} className={inputClass(fieldError?.field === "description", "resize-y py-2.5")} placeholder="What will the student learn?" />
        </FormField>
        <FormField id="lesson-order" label="Display order" error={fieldError?.field === "sortOrder" ? fieldError.message : undefined}>
          <input {...a11y("lesson-order", fieldError?.field === "sortOrder" ? fieldError.message : undefined)} type="number" min={0} max={10000} value={draft.sortOrder} onChange={(e) => { setDraft({ ...draft, sortOrder: e.target.value }); setFieldError(null); }} className={inputClass(fieldError?.field === "sortOrder", INPUT_HEIGHT)} />
        </FormField>
        <fieldset>
          <legend className="mb-2 text-[12px] font-semibold text-[#344054]">Video source</legend>
          <div className="grid grid-cols-2 gap-2">
            {(["YOUTUBE", "UPLOAD"] as const).map((media) => (
              <button key={media} type="button" onClick={() => setDraft({ ...draft, media })} className={`flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg border text-[12px] font-semibold ${draft.media === media ? "border-[#315c9f] bg-[#f2f6fb] text-[#315c9f]" : "border-[#dfe2e8] text-[#687182]"}`}>
                {media === "YOUTUBE" ? <Play size={16} /> : <Upload size={15} />} {media === "YOUTUBE" ? "YouTube" : "Upload video"}
              </button>
            ))}
          </div>
        </fieldset>
        {draft.media === "YOUTUBE" ? (
          <FormField id="youtube-url" label="YouTube URL" error={fieldError?.field === "youtubeUrl" ? fieldError.message : undefined} hint="Public or unlisted YouTube links are supported.">
            <input {...a11y("youtube-url", fieldError?.field === "youtubeUrl" ? fieldError.message : undefined)} type="url" value={draft.youtubeUrl} onChange={(e) => { setDraft({ ...draft, youtubeUrl: e.target.value }); setFieldError(null); }} maxLength={500} className={inputClass(fieldError?.field === "youtubeUrl", INPUT_HEIGHT)} placeholder="https://www.youtube.com/watch?v=…" />
          </FormField>
        ) : (
          <FormField id="lesson-file" label={lesson?.media_kind === "UPLOAD" && lesson.media_ready ? "Replace video (optional)" : "Video file"} error={fieldError?.field === "file" ? fieldError.message : undefined} hint={lesson?.media_kind === "UPLOAD" && lesson.media_ready ? "Leave empty to keep the current video. MP4 or WebM only." : "MP4 or WebM only. The server checks the file after upload."}>
            <input {...a11y("lesson-file", fieldError?.field === "file" ? fieldError.message : undefined)} type="file" accept="video/mp4,video/webm" onChange={(e) => { setDraft({ ...draft, file: e.target.files?.[0] ?? null }); setFieldError(null); }} className={`block w-full cursor-pointer rounded-lg border bg-white text-[12px] text-[#687182] file:mr-3 file:h-10 file:border-0 file:border-r file:border-[#dfe2e8] file:bg-[#f7f8fa] file:px-3 file:text-[11px] file:font-semibold file:text-[#344054] ${fieldError?.field === "file" ? "border-[#d92d20]" : "border-[#dfe2e8]"}`} />
          </FormField>
        )}
        {uploadProgress ? <p role="status" className="text-[11px] font-semibold text-[#315c9f]">{uploadProgress}</p> : null}
        <div className="flex items-center justify-between gap-3 border-t border-[#edf0f3] pt-4">
          {lesson ? <button type="button" onClick={toggleActive} disabled={saving} className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] font-semibold text-[#a83d44] disabled:opacity-50"><CircleOff size={14} /> {lesson.active ? "Deactivate" : "Activate"} lesson</button> : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} disabled={saving} className="h-9 cursor-pointer rounded-lg border border-[#dfe2e8] px-4 text-[12px] font-semibold text-[#344054] disabled:opacity-50">Cancel</button>
            <button type="submit" disabled={saving} className="h-9 cursor-pointer rounded-lg bg-[#151b2b] px-4 text-[12px] font-semibold text-white disabled:opacity-50">{saving ? uploadProgress ?? "Saving…" : lesson ? "Save changes" : "Add lesson"}</button>
          </div>
        </div>
      </form>
    </CourseDrawer>
  );
}

function PublishDialog({ course, onClose, onError }: { course: AdminCourse; onClose: () => void; onError: (error: unknown) => void }) {
  const dispatch = useAppDispatch();
  const [publish, state] = usePublishAdminCourseMutation();
  async function confirm() {
    try {
      await publish({ code: course.code, published: !course.published }).unwrap();
      dispatch(showAdminFeedback(course.published ? "Course unpublished." : "Course published."));
      onClose();
    } catch (error) { onError(error); onClose(); }
  }
  return (
    <Modal open title={course.published ? "Unpublish course?" : "Publish course?"} description={course.published ? "New students will no longer be able to purchase it. Existing buyers keep access." : "The course will be available for students to purchase. It must contain at least one playable lesson."} onClose={onClose} closeDisabled={state.isLoading}>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} disabled={state.isLoading} className="h-9 cursor-pointer rounded-lg border border-[#dfe2e8] px-4 text-[12px] font-semibold text-[#344054]">Cancel</button>
        <button type="button" onClick={confirm} disabled={state.isLoading} className={`h-9 cursor-pointer rounded-lg px-4 text-[12px] font-semibold text-white disabled:opacity-50 ${course.published ? "bg-[#b4454b]" : "bg-[#151b2b]"}`}>{state.isLoading ? "Saving…" : course.published ? "Unpublish" : "Publish"}</button>
      </div>
    </Modal>
  );
}

function CourseDrawer({ title, description, onClose, closeDisabled = false, wide = false, children }: {
  title: string;
  description: string;
  onClose: () => void;
  closeDisabled?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  useScrollLock(true);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !closeDisabled) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [closeDisabled, onClose]);

  return (
    <div data-scroll-lock-root className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="Close drawer"
        disabled={closeDisabled}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-[#172033]/30 disabled:cursor-wait"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="course-drawer-title"
        aria-describedby="course-drawer-description"
        className={`absolute right-0 top-0 flex h-full max-w-full flex-col bg-white shadow-[-20px_0_60px_-24px_rgba(0,0,0,0.5)] ${wide ? "w-[620px]" : "w-[480px]"}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-[#e5e7eb] px-5 py-4">
          <div>
            <h2 id="course-drawer-title" className="text-[18px] font-bold text-[#172033]">{title}</h2>
            <p id="course-drawer-description" className="mt-1 text-[12px] leading-[18px] text-[#7b8494]">{description}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={closeDisabled}
            aria-label="Close drawer"
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-lg text-[#7b8494] hover:bg-[#f5f6f8] hover:text-[#151b2b] disabled:cursor-wait disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
      </aside>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg bg-[#f7f8fa] px-3.5 py-3"><p className="text-[10px] font-medium uppercase tracking-wide text-[#7b8494]">{label}</p><p className="mt-1 text-[16px] font-semibold text-[#172033]">{value}</p></div>;
}

function StatusPill({ active, activeText, inactiveText }: { active: boolean; activeText: string; inactiveText: string }) {
  return <span className={`inline-flex rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-wide ${active ? "bg-[#eef7f1] text-[#2f7b4b]" : "bg-[#f0f2f5] text-[#687182]"}`}>{active ? activeText : inactiveText}</span>;
}

function CoursesSkeleton() {
  return <div className="space-y-4"><Skeleton className="h-10 w-[320px]" /><Skeleton className="h-40 w-full" /><Skeleton className="h-32 w-full" /><Skeleton className="h-32 w-full" /></div>;
}
