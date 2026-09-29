import {
  createSlice,
  PayloadAction,
} from "@reduxjs/toolkit";

import type { JobStatus } from "@/features/employer/jobs/types";

export type JobsStatusFilter = "all" | JobStatus;

export interface EmployerJobsState {
  search: string;

  statusFilter: JobsStatusFilter;
}

const initialState: EmployerJobsState = {
  search: "",

  statusFilter: "all",
};

const jobsSlice = createSlice({
  name: "employerJobs",

  initialState,

  reducers: {
    setJobsSearch: (
      state,
      action: PayloadAction<string>,
    ) => {
      state.search = action.payload;
    },

    setJobsStatusFilter: (
      state,
      action: PayloadAction<JobsStatusFilter>,
    ) => {
      state.statusFilter = action.payload;
    },
  },
});

export const {
  setJobsSearch,
  setJobsStatusFilter,
} = jobsSlice.actions;

export default jobsSlice.reducer;
