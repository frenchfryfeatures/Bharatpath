import { baseApi } from "@/store/api/base-api";
export type Level = "qualification" | "course" | "specialization";
export interface Option {
  id: string; name: string; parent_id: string | null; parent_name: string | null; level_rank: number | null; is_not_applicable: boolean; courses?: {id: string; name: string}[]; link_version?: number;
  is_visible: boolean; is_user_added: boolean; sort_order: number; version: number;
  usage_count: number; others_pending: number; updated_at: string;
}
export interface Submission {
  id: string; raw_text: string; level: Level; parent_id: string | null; parent_chain: Record<string, string>;
  parent_labels: string[]; user_id: string; user_email: string | null; created_at: string; status: string; count: number; version: number;
}
export interface Page<T> {items: T[]; total: number; has_more: boolean}
export const educationAdminApi = baseApi.injectEndpoints({endpoints: (builder) => ({
  educationAdminOptions: builder.query<Page<Option>, string>({query: (path) => `/admin/education-taxonomy/${path}`, providesTags: [{type: "Admin", id: "EDUCATION"}]}),
  educationSubmissions: builder.query<Page<Submission>, string>({query: (query) => `/admin/education-taxonomy/others?${query}`, providesTags: [{type: "Admin", id: "EDUCATION"}]}),
  educationRevision: builder.query<{revision: number}, void>({query: () => "/admin/education-taxonomy/revision", providesTags: [{type: "Admin", id: "EDUCATION"}]}),
  changeEducation: builder.mutation<unknown, {path: string; method?: "POST" | "PUT" | "DELETE"; body?: unknown}>({
    query: ({path, method = "POST", body}) => ({url: `/admin/education-taxonomy/${path}`, method, body}), invalidatesTags: [{type: "Admin", id: "EDUCATION"}],
  }),
  exportEducation: builder.mutation<Blob, {level: Level; format: "csv" | "xlsx"}>({
    query: ({level, format}) => ({url: `/admin/education-taxonomy/${level}/export?format=${format}`, responseHandler: (response: Response) => response.blob()}),
  }),
})});
