import type { RootState } from "@/store";

export const selectJobsSearch = (
  state: RootState,
) => state.employerJobs.search;

export const selectJobsStatusFilter = (
  state: RootState,
) => state.employerJobs.statusFilter;
