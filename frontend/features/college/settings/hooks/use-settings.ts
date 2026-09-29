"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  useAddCollegeTeamMemberMutation,
  useChangeCollegeTeamMemberRoleMutation,
  useGetCollegeOrganisationQuery,
  useGetCollegeSeatsQuery,
  useGetCollegeTeamQuery,
  useRemoveCollegeTeamMemberMutation,
  useUpdateCollegeOrganisationMutation,
} from "@/store/college/settings/settings.api";

import {
  useCancelCollegeSubscriptionMutation,
  useCreateCollegeCheckoutMutation,
  useGetCollegePlansQuery,
  useGetCollegeSubscriptionQuery,
} from "@/store/college/billing/billing.api";

import type {
  CollegeTeamMember,
  CollegeTeamRole,
} from "@/store/college/types";

import type { CollegeUser, SettingsTab, UserRole } from "../types";

const ROLE_LABELS: Record<CollegeTeamRole, UserRole> = {
  COLLEGE_ADMIN: "Admin",
  COLLEGE_STAFF: "Staff",
};

type SettingsDataScope = "header" | "profile" | "users" | "billing";

function initialsFor(email: string): string {
  const parts = email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean);

  return (
    parts
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?"
  );
}

function displayNameFor(email: string): string {
  const parts = email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean);

  if (parts.length === 0) {
    return "Team member";
  }

  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toUser(member: CollegeTeamMember): CollegeUser {
  return {
    ...member,
    initials: initialsFor(member.email),
    displayName: displayNameFor(member.email),
    roleLabel: ROLE_LABELS[member.role],
  };
}

/*
 * Single source of truth for the college settings screen. Each mounted
 * surface explicitly selects the data it needs so inactive tabs do not start
 * network requests.
 */
export function useSettings(scope: SettingsDataScope) {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  /* Profile */
  const organisationQuery = useGetCollegeOrganisationQuery(undefined, {
    skip: scope !== "profile",
  });
  const [updateOrganisation, updateOrganisationState] =
    useUpdateCollegeOrganisationMutation();

  const [draftName, setDraftName] = useState("");
  const [draftInstitutionType, setDraftInstitutionType] = useState<
    string | null
  >(null);

  /*
   * Seed the editable draft from the server once the organisation loads.
   */
  const organisation = organisationQuery.data;
  useEffect(() => {
    if (organisation) {
      setDraftName(organisation.name);
      setDraftInstitutionType(organisation.institutionType);
    }
  }, [organisation]);

  const saveProfile = useCallback(async () => {
    await updateOrganisation({
      name: draftName,
      institutionType: draftInstitutionType,
    }).unwrap();
  }, [updateOrganisation, draftName, draftInstitutionType]);

  /* Team */
  const teamQuery = useGetCollegeTeamQuery(undefined, {
    skip: scope !== "users",
  });
  const [addMember, addMemberState] = useAddCollegeTeamMemberMutation();
  const [changeRole] = useChangeCollegeTeamMemberRoleMutation();
  const [removeMember] = useRemoveCollegeTeamMemberMutation();

  const users = useMemo<CollegeUser[]>(
    () => (teamQuery.data ?? []).map(toUser),
    [teamQuery.data],
  );

  const inviteUser = useCallback(
    (email: string, role: CollegeTeamRole) =>
      addMember({ email, role }).unwrap(),
    [addMember],
  );

  const changeUserRole = useCallback(
    (userId: string, role: CollegeTeamRole) =>
      changeRole({ userId, role }).unwrap(),
    [changeRole],
  );

  const removeUser = useCallback(
    (userId: string) => removeMember(userId).unwrap(),
    [removeMember],
  );

  /* Seats */
  const seatsQuery = useGetCollegeSeatsQuery(undefined, {
    skip: scope !== "header" && scope !== "billing",
  });

  /* Billing */
  const subscriptionQuery = useGetCollegeSubscriptionQuery(undefined, {
    skip: scope !== "billing",
  });
  const plansQuery = useGetCollegePlansQuery(undefined, {
    skip: scope !== "billing",
  });
  const [createCheckout, checkoutState] = useCreateCollegeCheckoutMutation();
  const [cancelSubscription, cancelState] =
    useCancelCollegeSubscriptionMutation();

  const checkout = useCallback(
    (planCode: string) => createCheckout({ planCode }).unwrap(),
    [createCheckout],
  );

  return {
    activeTab,
    changeTab: setActiveTab,

    /* Profile */
    organisation: organisation ?? null,
    isLoadingProfile: organisationQuery.isLoading,
    draftName,
    setDraftName,
    draftInstitutionType,
    setDraftInstitutionType,
    isSavingProfile: updateOrganisationState.isLoading,
    saveProfile,

    /* Team */
    users,
    isLoadingUsers: teamQuery.isLoading,
    inviteUser,
    isInvitingUser: addMemberState.isLoading,
    changeUserRole,
    removeUser,

    /* Seats */
    seats: seatsQuery.data ?? null,
    isLoadingSeats: seatsQuery.isLoading,

    /* Billing */
    subscription: subscriptionQuery.data ?? null,
    plans: plansQuery.data ?? [],
    isLoadingBilling: subscriptionQuery.isLoading || plansQuery.isLoading,
    checkout,
    isCheckingOut: checkoutState.isLoading,
    cancelSubscription: () => cancelSubscription().unwrap(),
    isCancelling: cancelState.isLoading,
  };
}
