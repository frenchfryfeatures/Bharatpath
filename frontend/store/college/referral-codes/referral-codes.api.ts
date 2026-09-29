import { baseApi } from "@/store/api/base-api";

import type {
  ReferralCode,
  ReferralCodesPage,
} from "./types";

interface ReferralCodeResponse {
  id: string;
  code: string;
  state: ReferralCode["state"];
  uses: number;
  max_uses: number | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

interface ReferralCodesPageResponse {
  items: ReferralCodeResponse[];
  next_cursor: string | null;
}

function mapReferralCode(
  code: ReferralCodeResponse,
): ReferralCode {
  return {
    id: code.id,
    code: code.code,
    state: code.state,
    uses: code.uses,
    maxUses: code.max_uses,
    expiresAt: code.expires_at,
    revokedAt: code.revoked_at,
    createdAt: code.created_at,
  };
}

export const collegeReferralCodesApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getReferralCodes: builder.infiniteQuery<
      ReferralCodesPage,
      void,
      string | undefined
    >({
      infiniteQueryOptions: {
        initialPageParam: undefined,
        getNextPageParam: (lastPage) =>
          lastPage.nextCursor ?? undefined,
      },
      query: ({ pageParam }) => ({
        url: "/college/referral-codes",
        method: "GET",
        params: {
          cursor: pageParam,
          limit: 30,
        },
      }),
      transformResponse: (
        response: ReferralCodesPageResponse,
      ): ReferralCodesPage => ({
        items: response.items.map(mapReferralCode),
        nextCursor: response.next_cursor,
      }),
      providesTags: [
        { type: "College", id: "REFERRAL_CODES" },
      ],
    }),

    getActiveReferralCode: builder.query<ReferralCode | null, void>({
      query: () => ({
        url: "/college/referral-codes",
        method: "GET",
        params: {
          active_only: true,
          limit: 1,
        },
      }),
      transformResponse: (
        response: ReferralCodesPageResponse,
      ) => response.items[0] ? mapReferralCode(response.items[0]) : null,
      providesTags: [
        { type: "College", id: "REFERRAL_CODES" },
      ],
    }),

    issueReferralCode: builder.mutation<
      ReferralCode,
      { expiresInDays?: number; maxUses?: number | null }
    >({
      query: (payload) => ({
        url: "/college/referral-codes",
        method: "POST",
        body: {
          expires_in_days: payload.expiresInDays ?? 90,
          max_uses: payload.maxUses ?? null,
        },
      }),
      transformResponse: mapReferralCode,
      invalidatesTags: [
        { type: "College", id: "REFERRAL_CODES" },
      ],
    }),

    revokeReferralCode: builder.mutation<
      ReferralCode,
      string
    >({
      query: (codeId) => ({
        url: `/college/referral-codes/${codeId}/revoke`,
        method: "POST",
      }),
      transformResponse: mapReferralCode,
      invalidatesTags: [
        { type: "College", id: "REFERRAL_CODES" },
      ],
    }),
  }),
  overrideExisting: false,
});

export const {
  useGetReferralCodesInfiniteQuery,
  useGetActiveReferralCodeQuery,
  useIssueReferralCodeMutation,
  useRevokeReferralCodeMutation,
} = collegeReferralCodesApi;
