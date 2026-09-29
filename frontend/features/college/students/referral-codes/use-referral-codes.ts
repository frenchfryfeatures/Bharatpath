"use client";

import { useMemo } from "react";

import {
  useGetReferralCodesInfiniteQuery,
  useIssueReferralCodeMutation,
  useRevokeReferralCodeMutation,
} from "@/store/college/referral-codes";

export function useReferralCodes() {
  const query = useGetReferralCodesInfiniteQuery(undefined);
  const [issueReferralCode, issueState] =
    useIssueReferralCodeMutation();
  const [revokeReferralCode, revokeState] =
    useRevokeReferralCodeMutation();
  const referralCodes = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );

  return {
    referralCodes,
    isLoadingReferralCodes: query.isLoading,
    referralCodesError: query.isError && query.data === undefined,
    isLoadingMoreReferralCodes: query.isFetchingNextPage,
    hasMoreReferralCodes: query.hasNextPage,
    referralCodesLoadMoreError:
      query.isError && query.data !== undefined,
    loadMoreReferralCodes: () => {
      void query.fetchNextPage();
    },
    retryReferralCodes: () => {
      void query.refetch();
    },
    issueReferralCode,
    isIssuingCode: issueState.isLoading,
    revokeReferralCode,
    isRevokingCode: revokeState.isLoading,
  };
}
