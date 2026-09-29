"use client";

import { useGetCollegeSeatsQuery } from "@/store/college/settings/settings.api";

import { useReferralCodes } from "./referral-codes/use-referral-codes";
import {
  useStudentRoster,
  type StudentStatus,
} from "./roster";
import { useRosterImports } from "./roster-imports/use-roster-imports";

export function useStudents(
  search: string,
  status: StudentStatus | "all",
) {
  const roster = useStudentRoster(search, status);
  const referralCodes = useReferralCodes();
  const rosterImports = useRosterImports();
  const seatsQuery = useGetCollegeSeatsQuery();

  return {
    ...roster,
    seats: seatsQuery.data ?? null,
    isLoadingSeats:
      seatsQuery.isLoading || seatsQuery.isFetching,
    ...referralCodes,
    ...rosterImports,
  };
}
