import { baseApi } from "@/store/api/base-api";
export type Level = "industry" | "department" | "category" | "role";
export interface Option {
  id: string; name: string; parent_id: string | null; parent_name: string | null; type: "Tech" | "Non-tech" | null;
  is_visible: boolean; is_user_added: boolean; sort_order: number; version: number;
  usage_count: number; others_pending: number; updated_at: string;
}
export interface Submission {
  id: string; raw_text: string; level: Level; parent_id: string | null; parent_chain: Record<string, string>;
  parent_labels: string[]; user_id: string; user_email: string | null; created_at: string; status: string; count: number; version: number;
}
export interface Page<T> {items: T[]; total: number; has_more: boolean}
export const taxonomyAdminApi = baseApi.injectEndpoints({endpoints: (builder) => ({
  taxonomyAdminOptions: builder.query<Page<Option>, string>({query: (path) => `/admin/taxonomy/${path}`, providesTags: [{type: "Admin", id: "TAXONOMY"}]}),
  taxonomySubmissions: builder.query<Page<Submission>, string>({query: (query) => `/admin/taxonomy/others?${query}`, providesTags: [{type: "Admin", id: "TAXONOMY"}]}),
  taxonomyPriorities: builder.query<{department_ids: string[]; revision: string}, string>({query: (id) => `/admin/taxonomy/priorities/${id}`, providesTags: [{type: "Admin", id: "TAXONOMY"}]}),
  changeTaxonomy: builder.mutation<unknown, {path: string; method?: "POST" | "PUT" | "DELETE"; body?: unknown}>({
    query: ({path, method = "POST", body}) => ({url: `/admin/taxonomy/${path}`, method, body}), invalidatesTags: [{type: "Admin", id: "TAXONOMY"}],
  }),
  exportTaxonomy: builder.mutation<Blob, {level: Level; format: "csv" | "xlsx"}>({
    query: ({level, format}) => ({url: `/admin/taxonomy/${level}/export?format=${format}`, responseHandler: (response: Response) => response.blob()}),
  }),
})});
