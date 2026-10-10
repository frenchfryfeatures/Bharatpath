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
  useGetAdminKybApprovalModeQuery,
  useSetAdminKybApprovalModeMutation,
} from "@/store/api/admin-api";

import { useSessionIdentity } from "@/lib/auth/use-session-identity";

import type {
  KybMode,
  SettingsTab,
} from "../types";

export function useSettings() {
  const dispatch = useAppDispatch();

  const state = useAppSelector(
    selectAdminSettings,
  );
  const configQuery = useGetAdminKybApprovalModeQuery();
  const [setApprovalMode, modeMutation] = useSetAdminKybApprovalModeMutation();

  const setTab = (
    tab: SettingsTab,
  ) => {
    dispatch(setSettingsTab(tab));
  };

  // Anyone with the kyb capability can read the switch; only a platform
  // admin can flip it (capability `kyb_policy`).
  const canChangeKybMode =
    useSessionIdentity().user?.backendRole === "PLATFORM_ADMIN";

  const setKybMode = async (mode: KybMode) => {
    await setApprovalMode(mode === "manual").unwrap();
  };

  return {
    state: {
      ...state,
      kybMode: configQuery.data?.review_required ? "manual" as const : "auto" as const,
    },

    isLoading: configQuery.isLoading,

    error: configQuery.error,

    canChangeKybMode,

    isSaving: modeMutation.isLoading,
    saveError: modeMutation.error,
    setKybMode,

    setTab,
  };
}
