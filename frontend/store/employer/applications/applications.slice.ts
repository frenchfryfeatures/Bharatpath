import {
  createSlice,
  PayloadAction,
} from "@reduxjs/toolkit";

import type {
  ApplicationOutcome,
  ApplicationStage,
  EmployerApplication,
} from "@/features/employer/applications/types";

export interface EmployerApplicationsState {
  items: EmployerApplication[];

  selectedJobId: string;

  openApplicationId: string | null;
}

const initialState: EmployerApplicationsState = {
  items: [],

  selectedJobId: "all",

  openApplicationId: null,
};

const applicationsSlice = createSlice({
  name: "employerApplications",

  initialState,

  reducers: {
    replaceApplications: (
      state,
      action: PayloadAction<EmployerApplication[]>,
    ) => {
      state.items = action.payload;
    },

    appendApplications: (
      state,
      action: PayloadAction<EmployerApplication[]>,
    ) => {
      const existingIds = new Set(
        state.items.map((application) => application.id),
      );
      state.items.push(
        ...action.payload.filter(
          (application) => !existingIds.has(application.id),
        ),
      );
    },

    replaceApplication: (
      state,
      action: PayloadAction<EmployerApplication>,
    ) => {
      const index = state.items.findIndex(
        (application) => application.id === action.payload.id,
      );

      if (index >= 0) {
        state.items[index] = {
          ...action.payload,
          jobLocation:
            action.payload.jobLocation ??
            state.items[index].jobLocation,
          candidate: {
            ...action.payload.candidate,
            jobTitle: state.items[index].candidate.jobTitle,
          },
        };
      } else {
        state.items.push(action.payload);
      }
    },
    setApplicationJobFilter: (
      state,
      action: PayloadAction<string>,
    ) => {
      state.selectedJobId = action.payload;
    },

    openApplication: (
      state,
      action: PayloadAction<string>,
    ) => {
      state.openApplicationId = action.payload;
    },

    closeApplication: (state) => {
      state.openApplicationId = null;
    },

    moveApplicationStage: (
      state,
      action: PayloadAction<{
        applicationId: string;
        stage: ApplicationStage;
      }>,
    ) => {
      const application = state.items.find(
        (item) =>
          item.id === action.payload.applicationId,
      );

      if (!application) {
        return;
      }

      application.stage =
        action.payload.stage;

      /*
       * Moving an application back into the
       * active pipeline removes any terminal outcome.
       */
      if (action.payload.stage !== 4) {
        application.outcome = null;
      }
    },

    setApplicationOutcome: (
      state,
      action: PayloadAction<{
        applicationId: string;
        outcome: ApplicationOutcome;
      }>,
    ) => {
      const application = state.items.find(
        (item) =>
          item.id === action.payload.applicationId,
      );

      if (!application) {
        return;
      }

      application.outcome =
        action.payload.outcome;

      application.stage = 4;
    },

    setMeetingLink: (
      state,
      action: PayloadAction<{
        applicationId: string;
        meetingLink: string;
      }>,
    ) => {
      const application = state.items.find(
        (item) =>
          item.id === action.payload.applicationId,
      );

      if (!application) {
        return;
      }

      application.meetingLink =
        action.payload.meetingLink;
    },

    confirmEmployerHire: (
      state,
      action: PayloadAction<string>,
    ) => {
      const application = state.items.find(
        (item) =>
          item.id === action.payload,
      );

      if (!application) {
        return;
      }

      application.hireEmployerConfirmed = true;

      if (application.hireCandidateConfirmed) {
        application.stage = 4;
        application.outcome = "hired";
      }
    },
  },
});

export const {
  replaceApplications,
  appendApplications,
  replaceApplication,
  setApplicationJobFilter,
  openApplication,
  closeApplication,
  moveApplicationStage,
  setApplicationOutcome,
  setMeetingLink,
  confirmEmployerHire,
} = applicationsSlice.actions;

export default applicationsSlice.reducer;