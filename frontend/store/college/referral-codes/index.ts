export {
  collegeReferralCodesApi,
  useGetActiveReferralCodeQuery,
  useGetReferralCodesInfiniteQuery,
  useIssueReferralCodeMutation,
  useRevokeReferralCodeMutation,
} from "./referral-codes.api";

export type {
  ReferralCode,
  ReferralCodeState,
  ReferralCodesPage,
} from "./types";
