import { baseApi } from "@/store/api/base-api";
import type { StructuredResume } from "@/components/resume/structured-resume";

/*
 * The resume builder - `/candidate/resume-builder/*` (backend-guide/18).
 * The draft is the review screen's `StructuredResume`; nothing here scores.
 */

export type BuilderTemplateKey = "classic" | "modern" | "sidebar" | "minimal";

export interface BuilderTemplate {
  key: BuilderTemplateKey;
  name: string;
  description: string;
  columns: number;
}

export interface BuilderDraft {
  template_key: BuilderTemplateKey;
  content: StructuredResume;
  saved: boolean;
  updated_at: string | null;
  download_count: number;
  pushed_version_id: string | null;
  pushed_at: string | null;
  pushed_is_current: boolean;
}

export interface BuilderPreview {
  pages: string[];
  mime: "image/png" | "image/svg+xml";
  page_count: number;
}

export interface BuilderPush {
  resume_version_id: string;
  resume_file_id: string | null;
  created: boolean;
  confirmed: boolean;
}

export interface BuilderDraftBody {
  template_key: BuilderTemplateKey;
  content: StructuredResume;
}

const BASE = "/candidate/resume-builder";

export const studentResumeBuilderApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getBuilderTemplates: builder.query<
      { templates: BuilderTemplate[]; default: BuilderTemplateKey },
      void
    >({ query: () => `${BASE}/templates` }),

    getBuilderDraft: builder.query<BuilderDraft, void>({
      query: () => `${BASE}/draft`,
      keepUnusedDataFor: 0,
    }),

    saveBuilderDraft: builder.mutation<BuilderDraft, BuilderDraftBody>({
      query: (body) => ({ url: `${BASE}/draft`, method: "PUT", body }),
    }),

    resetBuilderDraft: builder.mutation<BuilderDraft, void>({
      query: () => ({ url: `${BASE}/draft/reset`, method: "POST" }),
    }),

    previewBuilder: builder.mutation<BuilderPreview, BuilderDraftBody>({
      query: (body) => ({ url: `${BASE}/preview`, method: "POST", body }),
    }),

    /** The saved draft as a PDF, handed back as an object URL to click. */
    downloadBuilder: builder.mutation<{ url: string; filename: string }, void>({
      queryFn: async (_arg, api, extra, baseQuery) => {
        const result = await baseQuery({
          url: `${BASE}/download`,
          method: "POST",
          responseHandler: (response: Response) => response.blob(),
        });
        if (result.error) return { error: result.error };
        const disposition = result.meta?.response?.headers.get("content-disposition") ?? "";
        const filename = /filename="?([^";]+)"?/i.exec(disposition)?.[1] ?? "Resume.pdf";
        return { data: { url: URL.createObjectURL(result.data as Blob), filename } };
      },
    }),

    pushBuilder: builder.mutation<BuilderPush, void>({
      query: () => ({ url: `${BASE}/push`, method: "POST" }),
      invalidatesTags: [{ type: "Student", id: "RESUME_VERSIONS" }],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetBuilderTemplatesQuery,
  useGetBuilderDraftQuery,
  useSaveBuilderDraftMutation,
  useResetBuilderDraftMutation,
  usePreviewBuilderMutation,
  useDownloadBuilderMutation,
  usePushBuilderMutation,
} = studentResumeBuilderApi;
