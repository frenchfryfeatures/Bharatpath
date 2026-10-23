"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";

import { usePageHeader } from "@/components/layout/header-context";
import { useAppDispatch } from "@/store/hooks";
import { setUserSegment } from "@/store/admin/users/slice";

import { useUsers } from "../hooks/use-users";

import { ErrorState } from "@/components/ui";

import { LeadsTab, LEAD_TABS, type LeadTab } from "./leads-tab";
import { useLeads } from "../hooks/use-leads";
import { CandidatesTab } from "./candidates-tab";
import { EmployersTab } from "./employers-tab";
import { InstitutionsTab } from "./institutions-tab";
import { UserDrawer } from "./user-drawer";
import { CreateUserDrawer } from "./create-user-drawer";

import type { UserSegment } from "../types";

export function UsersPage({ section = "candidates" }: { section?: "candidates" | "organisations" }) {
  const isOrganisations = section === "organisations";
  const [drawerMode, setDrawerMode] = useState<"create" | "invite" | null>(null);
  const searchParams = useSearchParams();
  const requestedSegment = searchParams.get("segment");
  const isAllCandidates = !isOrganisations && searchParams.get("tab") === "all";
  const leadTab: LeadTab = searchParams.get("tab") === "signed_up" ? "signed_up" : "others";
  const selectedSegment: UserSegment = isOrganisations
    ? requestedSegment === "institutions" ? "institutions" : "employers"
    : "candidates";
  usePageHeader(
    isOrganisations ? "Organisation" : "Users",
    isOrganisations
      ? "Employers and institutions on the platform"
      : "Candidates on the platform",
  );

  const {
    segment,
    renderFilterControls,
    searching,
    filteredUsers,
    isLoading,
    error,
    openUser,
    selectedId,
    closeUser,
    setSegment,
    pageSize,
    currentPage,
    hasNextPage,
    setPageSize,
    goToNextPage,
    goToPreviousPage,
  } = useUsers(selectedSegment, isOrganisations || isAllCandidates);

  const leads = useLeads(leadTab, !isOrganisations && !isAllCandidates);

  // Organisation links can select a tab; old Users links still reach it.
  const dispatch = useAppDispatch();
  const router = useRouter();
  useEffect(() => {
    if (!isOrganisations && (requestedSegment === "employers" || requestedSegment === "institutions")) {
      router.replace(`/admin/organisations?segment=${requestedSegment}`);
      return;
    }
    dispatch(setUserSegment(selectedSegment));
  }, [dispatch, isOrganisations, requestedSegment, router, selectedSegment]);

  const pagination = {
    pageSize,
    currentPage,
    hasNextPage,
    onNextPage: goToNextPage,
    onPreviousPage: goToPreviousPage,
    onPageSizeChange: setPageSize,
  };

  const leadsPagination = leads.pagination;

  return (
    <div className="min-w-0 space-y-0">
      {/* ================================================================ */}
      {/* ORGANISATION TABS                                                */}
      {/* ================================================================ */}

      {isOrganisations ? <div className="overflow-x-auto border-b border-[#e7e9ee]">
        <div className="flex min-w-max items-center gap-1">
          {([
            ["employers", "Employers"],
            ["institutions", "Institutions"],
          ] as const).map(([key, label]) => {
            const active =
              segment === key;

            return (
              <button
                key={key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setSegment(key);
                  router.replace(`/admin/organisations?segment=${key}`, { scroll: false });
                }}
                className={[
                  "relative shrink-0 cursor-pointer px-4 py-3",
                  "text-[13px] font-semibold transition-colors",
                  active
                    ? "text-[#172033]"
                    : "text-[#687182] hover:text-[#172033]",
                ].join(" ")}
              >
                {label}

                {active && (
                  <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#315c9f]" />
                )}
              </button>
            );
          })}
        </div>
      </div> : null}

      {/* ================================================================ */}
      {/* CANDIDATE TABS: signed up and not paid, and everyone else         */}
      {/* ================================================================ */}

      {!isOrganisations ? <div className="overflow-x-auto border-b border-[#e7e9ee]">
        <div className="flex min-w-max items-center gap-1" role="tablist" aria-label="Candidates">
          <button type="button" role="tab" aria-selected={isAllCandidates}
            onClick={() => router.replace("/admin/users?tab=all", { scroll: false })}
            className={`shrink-0 border-b-2 px-4 py-3 text-[13px] font-semibold ${isAllCandidates ? "border-[#315c9f] text-[#172033]" : "border-transparent text-[#687182]"}`}>
            All candidates
          </button>
          {LEAD_TABS.map(({ key, label }) => {
            const active = !isAllCandidates && leadTab === key;
            const count = leads.counts[key];

            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => router.replace(`/admin/users?tab=${key}`, { scroll: false })}
                className={[
                  "relative inline-flex shrink-0 cursor-pointer items-center gap-2 px-4 py-3",
                  "text-[13px] font-semibold transition-colors",
                  active ? "text-[#172033]" : "text-[#687182] hover:text-[#172033]",
                ].join(" ")}
              >
                {label}
                {count !== null ? (
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${active ? "bg-[#eef0ff] text-[#385da8]" : "bg-[#f0f2f5] text-[#687182]"}`}>
                    {count.toLocaleString("en-IN")}
                  </span>
                ) : null}
                {active && <span className="absolute inset-x-0 bottom-0 h-[2px] bg-[#315c9f]" />}
              </button>
            );
          })}
        </div>
      </div> : null}

      {/* ================================================================ */}
      {/* ACCOUNT ACTIONS                                                   */}
      {/* ================================================================ */}

      {(isOrganisations || isAllCandidates ? renderFilterControls : leads.renderFilterControls)(
        <div className="flex max-w-full flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => setDrawerMode("invite")}
            className="inline-flex h-11 shrink-0 whitespace-nowrap cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#d7dce5] bg-white px-3 text-[12px] font-semibold text-[#172033] transition-colors hover:bg-[#f7f8fa] sm:flex-none sm:px-4"
          >
            Invite {segment === "candidates" ? "candidate" : segment === "employers" ? "employer" : "institution"}
          </button>
          <button
            type="button"
            onClick={() => setDrawerMode("create")}
            className="inline-flex h-11 shrink-0 whitespace-nowrap cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#151b2b] px-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#20283d] sm:flex-none sm:px-4"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create {segment === "candidates" ? "candidate" : segment === "employers" ? "employer" : "institution"}
          </button>
        </div>
      )}

      {/* ================================================================ */}
      {/* TAB CONTENT                                                       */}
      {/* ================================================================ */}


      {(isOrganisations || isAllCandidates) && error ? <ErrorState error={error} fallback="Could not load users." className="mb-3" /> : null}
      {!isOrganisations && !isAllCandidates && leads.error ? <ErrorState error={leads.error} fallback="Could not load candidates." className="mb-3" /> : null}

      {segment === "candidates" && isAllCandidates && <CandidatesTab users={filteredUsers} isLoading={isLoading} searching={searching} pagination={pagination} />}

      {segment === "candidates" && !isAllCandidates && (
        <LeadsTab
          tab={leadTab}
          leads={leads.rows}
          isLoading={leads.isLoading}
          searching={leads.searching}
          pagination={leadsPagination}
        />
      )}

      {segment === "employers" && (
        <EmployersTab
          users={filteredUsers}
          isLoading={isLoading}
          searching={searching}
          onOpen={openUser}
          pagination={pagination}
        />
      )}

      {segment === "institutions" && (
        <InstitutionsTab
          users={filteredUsers}
          isLoading={isLoading}
          searching={searching}
          onOpen={openUser}
          pagination={pagination}
        />
      )}
      <UserDrawer segment={segment} selectedId={selectedId} closeUser={closeUser} />
      {drawerMode ? (
        <CreateUserDrawer
          segment={segment}
          mode={drawerMode}
          onClose={() => setDrawerMode(null)}
        />
      ) : null}
    </div>
  );
}

export const AdminUsersPage =
  UsersPage;
