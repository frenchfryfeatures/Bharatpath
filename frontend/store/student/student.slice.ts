import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type BoardFilter =
  | "all"
  | "active"
  | "interview"
  | "closed";

export interface StudentState {
  savedJobIds: string[];
  jobSearch: string;
  jobQualifiedOnly: boolean;
  jobWorkMode: string | null;
  boardFilter: BoardFilter;
}

const initialState: StudentState = {
  savedJobIds: [],
  jobSearch: "",
  jobQualifiedOnly: true,
  jobWorkMode: null,
  boardFilter: "all",
};

const studentSlice = createSlice({
  name: "student",
  initialState,
  reducers: {
    resetStudentState: () => initialState,
    toggleSavedJob(state, action: PayloadAction<string>) {
      const id = action.payload;
      state.savedJobIds = state.savedJobIds.includes(id)
        ? state.savedJobIds.filter((saved) => saved !== id)
        : [...state.savedJobIds, id];
    },
    setJobSearch(state, action: PayloadAction<string>) {
      state.jobSearch = action.payload;
    },
    toggleQualifiedOnly(state) {
      state.jobQualifiedOnly = !state.jobQualifiedOnly;
    },
    setJobWorkMode(state, action: PayloadAction<string | null>) {
      state.jobWorkMode =
        state.jobWorkMode === action.payload ? null : action.payload;
    },
    setBoardFilter(state, action: PayloadAction<BoardFilter>) {
      state.boardFilter = action.payload;
    },
  },
});

export const {
  resetStudentState,
  toggleSavedJob,
  setJobSearch,
  toggleQualifiedOnly,
  setJobWorkMode,
  setBoardFilter,
} = studentSlice.actions;

export default studentSlice.reducer;
