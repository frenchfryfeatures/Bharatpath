"use client";

import {
  useAppDispatch,
  useAppSelector,
} from "@/store/hooks";

import {
  selectAdminSettings,
  setSettingsTab,
} from "@/store/admin";
import {
  useGetAdminKybSubmissionsQuery,
  useSetAdminKybApprovalModeMutation,
} from "@/store/api/admin-api";

import type {
  SettingsTab,
} from "../types";

export function useSettings() {
  const dispatch = useAppDispatch();

  const state = useAppSelector(
    selectAdminSettings,
  );
  const configQuery = useGetAdminKybSubmissionsQuery({ limit: 1 });
  const [setApprovalMode, modeMutation] = useSetAdminKybApprovalModeMutation();

  const setTab = (
    tab: SettingsTab,
  ) => {
    dispatch(setSettingsTab(tab));
  };

  const setKybMode = async (mode: "manual" | "auto") => {
    if (mode !== "auto") return;

    await setApprovalMode(false).unwrap();
  };

  return {
    state: {
      ...state,
      kybMode: configQuery.data?.review_required ? "manual" as const : "auto" as const,
    },

    isLoading: configQuery.isLoading,

    error: configQuery.error,

    isSaving: modeMutation.isLoading,
    saveError: modeMutation.error,
    setKybMode,

    setTab,
  };
}
