import {
  createSlice,
  type PayloadAction,
} from "@reduxjs/toolkit";

export type DashboardMetricTone =
  | "purple"
  | "amber"
  | "red"
  | "navy";

export type DashboardStatusTone =
  | "success"
  | "warning"
  | "neutral";

export interface DashboardMetric {
  title: string;
  value: number | string;
  tone: DashboardMetricTone;
  status: string;
  statusTone: DashboardStatusTone;
}

export interface OldestDashboardItem {
  id: string;
  href: string;
  name: string;
  meta: string;
  type: "KYB" | "Integrity" | "Dispute";
  risk: "High" | "Medium" | "Low" | "-";
  waiting: string;
}

export type PlatformTotalLabel =
  | "Candidates"
  | "Employers"
  | "Institutions"
  | "Published jobs"
  | "Applications"
  | "Confirmed hires";

export interface PlatformTotal {
  label: PlatformTotalLabel;
  value: string;
}

export interface IntakeClearedItem {
  date: string;
  day: string;
  dateLabel: string;
  intake: number;
  cleared: number;
  intakeHeight: number;
  clearedHeight: number;
}

export interface AdminDashboardState {
  metrics: DashboardMetric[];
  oldestItems: OldestDashboardItem[];
  platformTotals: PlatformTotal[];
  intakeCleared: IntakeClearedItem[];
}

const initialState: AdminDashboardState = {
  /*
   * ========================================================================
   * Metrics
   * ========================================================================
   */

  metrics: [],

  /*
   * ========================================================================
   * Oldest items
   * ========================================================================
   */

  oldestItems: [],

  /*
   * ========================================================================
   * Platform totals
   * ========================================================================
   */

  platformTotals: [],

  /*
   * ========================================================================
   * Intake vs cleared
   * ========================================================================
   */

  intakeCleared: [],
};

const dashboardSlice = createSlice({
  name: "adminDashboard",

  initialState,

  reducers: {
    setDashboard(
      state,
      action: PayloadAction<AdminDashboardState>,
    ) {
      state.metrics = action.payload.metrics;
      state.oldestItems = action.payload.oldestItems;
      state.platformTotals =
        action.payload.platformTotals;
      state.intakeCleared =
        action.payload.intakeCleared;
    },

    setDashboardMetrics(
      state,
      action: PayloadAction<DashboardMetric[]>,
    ) {
      state.metrics = action.payload;
    },

    setOldestDashboardItems(
      state,
      action: PayloadAction<OldestDashboardItem[]>,
    ) {
      state.oldestItems = action.payload;
    },

    setPlatformTotals(
      state,
      action: PayloadAction<PlatformTotal[]>,
    ) {
      state.platformTotals = action.payload;
    },

    setIntakeCleared(
      state,
      action: PayloadAction<IntakeClearedItem[]>,
    ) {
      state.intakeCleared = action.payload;
    },
  },
});

export const {
  setDashboard,
  setDashboardMetrics,
  setOldestDashboardItems,
  setPlatformTotals,
  setIntakeCleared,
} = dashboardSlice.actions;

export default dashboardSlice.reducer;
