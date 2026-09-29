import { baseApi } from "@/store/api/base-api";

import type {
  InvitationsSent,
  RosterImport,
  RosterImportsPage,
  RosterRow,
  RosterRowsPage,
} from "./types";

interface InvitationCountsResponse {
  pending: number;
  sent: number;
  accepted: number;
  declined: number;
  expired: number;
}

interface RosterImportResponse {
  id: string;
  file_name: string;
  state: RosterImport["state"];
  total_rows: number;
  valid_rows: number;
  invalid_rows: number;
  duplicate_rows: number;
  ignored_columns: string[];
  created_at: string;
  committed_at: string | null;
  invitations: InvitationCountsResponse;
}

interface RosterImportsPageResponse {
  items: RosterImportResponse[];
  next_cursor: string | null;
  invitation_totals: InvitationCountsResponse;
}

interface RosterRowResponse {
  row_number: number;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  student_ref: string | null;
  row_state: RosterRow["rowState"];
  issues: string[];
  invite_state: string | null;
}

interface RosterRowsPageResponse {
  items: RosterRowResponse[];
  next_cursor: string | null;
}

interface InvitationsSentResponse {
  sent: number;
  invitations: InvitationCountsResponse;
}

function mapRosterImport(
  import_: RosterImportResponse,
): RosterImport {
  return {
    id: import_.id,
    fileName: import_.file_name,
    state: import_.state,
    totalRows: import_.total_rows,
    validRows: import_.valid_rows,
    invalidRows: import_.invalid_rows,
    duplicateRows: import_.duplicate_rows,
    ignoredColumns: import_.ignored_columns,
    createdAt: import_.created_at,
    committedAt: import_.committed_at,
    invitations: {
      pending: import_.invitations.pending,
      sent: import_.invitations.sent,
      accepted: import_.invitations.accepted,
      declined: import_.invitations.declined,
      expired: import_.invitations.expired,
    },
  };
}

function mapRosterRow(row: RosterRowResponse): RosterRow {
  return {
    rowNumber: row.row_number,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    studentRef: row.student_ref,
    rowState: row.row_state,
    issues: row.issues,
    inviteState: row.invite_state,
  };
}

function mapInvitationsSent(
  response: InvitationsSentResponse,
): InvitationsSent {
  return {
    sent: response.sent,
    invitations: {
      pending: response.invitations.pending,
      sent: response.invitations.sent,
      accepted: response.invitations.accepted,
      declined: response.invitations.declined,
      expired: response.invitations.expired,
    },
  };
}

export const collegeRosterImportsApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    uploadRosterImport: builder.mutation<
      RosterImport,
      { fileName: string; csv: string }
    >({
      query: (payload) => ({
        url: "/college/roster-imports",
        method: "POST",
        body: {
          file_name: payload.fileName,
          csv: payload.csv,
        },
      }),
      transformResponse: mapRosterImport,
    }),

    getRosterImports: builder.infiniteQuery<
      RosterImportsPage,
      void,
      string | undefined
    >({
      infiniteQueryOptions: {
        initialPageParam: undefined,
        getNextPageParam: (lastPage) =>
          lastPage.nextCursor ?? undefined,
      },
      query: ({ pageParam }) => ({
        url: "/college/roster-imports",
        method: "GET",
        params: {
          cursor: pageParam,
          limit: 30,
        },
      }),
      transformResponse: (
        response: RosterImportsPageResponse,
      ): RosterImportsPage => ({
        items: response.items.map(mapRosterImport),
        nextCursor: response.next_cursor,
        invitationTotals: {
          pending: response.invitation_totals.pending,
          sent: response.invitation_totals.sent,
          accepted: response.invitation_totals.accepted,
          declined: response.invitation_totals.declined,
          expired: response.invitation_totals.expired,
        },
      }),
      providesTags: [
        { type: "College", id: "ROSTER_IMPORTS" },
      ],
    }),

    getRosterImport: builder.query<RosterImport, string>({
      query: (importId) => ({
        url: `/college/roster-imports/${importId}`,
        method: "GET",
      }),
      transformResponse: mapRosterImport,
      providesTags: (_result, _error, importId) => [
        { type: "College", id: `ROSTER_IMPORT_${importId}` },
      ],
    }),

    getRosterImportRows: builder.query<
      RosterRowsPage,
      {
        importId: string;
        rowState?: RosterRow["rowState"];
        cursor?: string;
        limit?: number;
      } | null
    >({
      query: (args) => {
        if (!args) {
          return { url: "", method: "GET" };
        }

        return {
          url: `/college/roster-imports/${args.importId}/rows`,
          method: "GET",
          params: {
            cursor: args.cursor,
            limit: args.limit,
            ...(args.rowState
              ? { row_state: args.rowState }
              : {}),
          },
        };
      },
      transformResponse: (
        response: RosterRowsPageResponse,
      ): RosterRowsPage => ({
        items: response.items.map(mapRosterRow),
        nextCursor: response.next_cursor,
      }),
    }),

    commitRosterImport: builder.mutation<
      RosterImport,
      string
    >({
      query: (importId) => ({
        url: `/college/roster-imports/${importId}/commit`,
        method: "POST",
      }),
      transformResponse: mapRosterImport,
      invalidatesTags: (_result, _error, importId) => [
        { type: "College", id: "ROSTER_IMPORTS" },
        { type: "College", id: `ROSTER_IMPORT_${importId}` },
      ],
    }),

    discardRosterImport: builder.mutation<
      RosterImport,
      string
    >({
      query: (importId) => ({
        url: `/college/roster-imports/${importId}/discard`,
        method: "POST",
      }),
      transformResponse: mapRosterImport,
      invalidatesTags: (_result, _error, importId) => [
        { type: "College", id: "ROSTER_IMPORTS" },
        { type: "College", id: `ROSTER_IMPORT_${importId}` },
      ],
    }),

    sendRosterInvitations: builder.mutation<
      InvitationsSent,
      string
    >({
      query: (importId) => ({
        url: `/college/roster-imports/${importId}/invitations/send`,
        method: "POST",
      }),
      transformResponse: mapInvitationsSent,
      invalidatesTags: (_result, _error, importId) => [
        { type: "College", id: "ROSTER_IMPORTS" },
        { type: "College", id: `ROSTER_IMPORT_${importId}` },
      ],
    }),
  }),
  overrideExisting: false,
});

export const {
  useUploadRosterImportMutation,
  useGetRosterImportsInfiniteQuery,
  useGetRosterImportQuery,
  useGetRosterImportRowsQuery,
  useCommitRosterImportMutation,
  useDiscardRosterImportMutation,
  useSendRosterInvitationsMutation,
} = collegeRosterImportsApi;
