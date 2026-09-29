import { configureStore } from "@reduxjs/toolkit";

import authReducer from "./common/slices/auth.slice";
import tenantReducer from "./common/slices/tenant.slice";
import uiReducer from "./common/slices/ui.slice";
import notificationUIReducer from "./common/slices/notification-slice";

import { baseApi } from "./api/base-api";
import { notificationApi } from "./api/notification-api";
import { successFeedbackMiddleware } from "./success-feedback-middleware";

import { collegeBillingReducer } from "./college/billing";
import collegeSettingsReducer from "./college/settings/college-settings.slice";

import employerBillingReducer from "./employer/billing/billing.slice";
import {
  employerApplicationsReducer,
} from "@/store/employer/applications";
import {
  employerJobsReducer,
} from "@/store/employer/jobs";
import employerSettingsReducer from "./employer/settings/settings-slice";
import { employerCandidatesReducer } from "./employer/candidates";
import { adminReducer } from "./admin";
import { studentReducer } from "./student";

export const store = configureStore({
  reducer: {
    /*
     * ==========================================
     * COMMON APPLICATION STATE
     * ==========================================
     */

    auth: authReducer,
    tenant: tenantReducer,
    ui: uiReducer,
    admin: adminReducer,

    /*
     * ==========================================
     * NOTIFICATION UI STATE
     *
     * Controls whether the notification
     * dropdown is open or closed.
     * ==========================================
     */

    notificationUI: notificationUIReducer,
    employerApplications: employerApplicationsReducer,
    employerJobs: employerJobsReducer,
    employerSettings: employerSettingsReducer,
    employerCandidates: employerCandidatesReducer,
    /*
     * ==========================================
     * COLLEGE PORTAL STATE
     * ==========================================
     */

    collegeBilling: collegeBillingReducer,
    collegeSettings: collegeSettingsReducer,

    /*
     * ==========================================
     * STUDENT PORTAL UI STATE
     * ==========================================
     */

    student: studentReducer,

    /*
     * ==========================================
     * EMPLOYER PORTAL STATE
     *
     * Billing-related state for the Employer
     * portal, including:
     *
     * - Credit balance
     * - Credit packages
     * - Selected credit package
     * ==========================================
     */

    employerBilling: employerBillingReducer,

    /*
     * ==========================================
     * RTK QUERY APIs
     * ==========================================
     */

    [baseApi.reducerPath]:
      baseApi.reducer,

    [notificationApi.reducerPath]:
      notificationApi.reducer,
  },

  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware().concat(
      successFeedbackMiddleware,

      /*
       * Existing application API
       */
      baseApi.middleware,

      /*
       * Notification API
       */
      notificationApi.middleware
    ),

  devTools:
    process.env.NODE_ENV !== "production",
});

/*
 * ==========================================
 * ROOT REDUX STATE
 * ==========================================
 */

export type RootState =
  ReturnType<typeof store.getState>;

/*
 * ==========================================
 * REDUX DISPATCH
 * ==========================================
 */

export type AppDispatch =
  typeof store.dispatch;

/*
 * ==========================================
 * REDUX STORE
 *
 * Required by useAppStore()
 * ==========================================
 */

export type AppStore =
  typeof store;