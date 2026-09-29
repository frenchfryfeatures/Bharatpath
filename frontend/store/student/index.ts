import type { RootState } from "@/store";

import studentReducer from "./student.slice";

export { studentReducer };
export * from "./student.slice";
export * from "./student.api";
export * from "./resume.api";

export const selectSavedJobIds = (state: RootState) =>
  state.student.savedJobIds;

export const selectIsJobSaved =
  (jobId: string) => (state: RootState) =>
    state.student.savedJobIds.includes(jobId);

export const selectJobSearch = (state: RootState) =>
  state.student.jobSearch;

export const selectJobQualifiedOnly = (state: RootState) =>
  state.student.jobQualifiedOnly;

export const selectJobWorkMode = (state: RootState) =>
  state.student.jobWorkMode;

export const selectBoardFilter = (state: RootState) =>
  state.student.boardFilter;
