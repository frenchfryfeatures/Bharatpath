"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Plus, Search } from "lucide-react";

import { usePageHeader } from "@/components/layout/header-context";
import { useAppDispatch } from "@/store/hooks";
import { setUserSegment } from "@/store/admin/users/slice";

import { useUsers } from "../hooks/use-users";

import { ErrorState } from "@/components/ui";

import { CandidatesTab } from "./candidates-tab";
import { EmployersTab } from "./employers-tab";
import { InstitutionsTab } from "./institutions-tab";
import { UserDrawer } from "./user-drawer";
import { CreateUserDrawer } from "./create-user-drawer";

import type { UserSegment } from "../types";

export function UsersPage({ section = "candidates" }: { section?: "candidates" | "organisations" }) {
  const isOrganisations = section === "organisations";
  const [drawerMode, setDrawerMode] = useState<"create" | "invite" | null>(null);
  const requestedSegment = useSearchParams().get("segment");
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
    search,
    filteredUsers,
    isLoading,
    error,
    openUser,
    selectedId,
    closeUser,
    setSegment,
    setSearch,
    pageSize,
    currentPage,
    hasNextPage,
    setPageSize,
    goToNextPage,
    goToPreviousPage,
  } = useUsers(selectedSegment);

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
      {/* SEARCH                                                            */}
      {/* ================================================================ */}

      <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex h-[38px] w-full min-w-0 items-center gap-2 rounded-lg border border-[#e2e5eb] bg-white px-3 transition-colors focus-within:border-[#315c9f] sm:w-[246px]">
          <Search className="h-4 w-4 shrink-0 text-[#667085]" />

          <input
            type="text"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search by name"
            className="w-full bg-transparent text-[12px] text-[#172033] outline-none placeholder:text-[#7b8494]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setDrawerMode("invite")}
            className="inline-flex h-[38px] min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-[#d7dce5] bg-white px-3 text-[12px] font-semibold text-[#172033] transition-colors hover:bg-[#f7f8fa] sm:flex-none sm:px-4"
          >
            Invite {segment === "candidates" ? "candidate" : segment === "employers" ? "employer" : "institution"}
          </button>
          <button
            type="button"
            onClick={() => setDrawerMode("create")}
            className="inline-flex h-[38px] min-w-0 flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#151b2b] px-3 text-[12px] font-semibold text-white transition-colors hover:bg-[#20283d] sm:flex-none sm:px-4"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create {segment === "candidates" ? "candidate" : segment === "employers" ? "employer" : "institution"}
          </button>
        </div>
      </div>

      {/* ================================================================ */}
      {/* TAB CONTENT                                                       */}
      {/* ================================================================ */}

      {error ? <ErrorState error={error} fallback={isOrganisations ? "Could not load organisations." : "Could not load candidates."} className="mb-3" /> : null}

      {segment === "candidates" && (
        <CandidatesTab
          users={filteredUsers}
          isLoading={isLoading}
          onOpen={openUser}
          pagination={pagination}
        />
      )}

      {segment === "employers" && (
        <EmployersTab
          users={filteredUsers}
          isLoading={isLoading}
          onOpen={openUser}
          pagination={pagination}
        />
      )}

      {segment === "institutions" && (
        <InstitutionsTab
          users={filteredUsers}
          isLoading={isLoading}
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
