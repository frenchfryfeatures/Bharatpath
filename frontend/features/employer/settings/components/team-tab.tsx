"use client";

import { useEffect, useMemo, useState } from "react";
import { Skeleton } from "@/components/common/loading";
import { AppSelect } from "@/components/ui/app-select";
import { createPortal } from "react-dom";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TablePagination,
  TableRow,
} from "@/components/ui/table";
import { EmployerErrorState } from "@/features/employer/components/employer-error-state";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  askRemoveMember,
  openInviteModal,
  replaceTeamMembers,
  resendInvite,
  selectTeamMembers,
  toggleMemberMenu,
  useGetEmployerTeamQuery,
} from "@/store/employer/settings";
import type { TeamMember } from "@/store/employer/settings";
import { useSessionIdentity } from "@/lib/auth/use-session-identity";
import { MoreVertical, Search, UserPlus } from "lucide-react";

const EMPTY_TEAM: TeamMember[] = [];

const ROLE_OPTIONS = [
  { value: "all", label: "All roles" },
  { value: "Owner", label: "Owner" },
  { value: "Recruiter", label: "Recruiter" },
  { value: "View only", label: "View only" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "Active", label: "Active" },
  { value: "Invited", label: "Invited" },
];

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function TeamTab() {
  const isOwner = useSessionIdentity().user?.backendRole === "EMPLOYER_OWNER";
  const dispatch = useAppDispatch();
  const members = useAppSelector(selectTeamMembers);
  const {
    data: team,
    isError,
    isLoading,
  } = useGetEmployerTeamQuery();

  // Do not expose a stale in-memory value before this tab's API request resolves.
  const displayedMembers = team ? members : EMPTY_TEAM;

  useEffect(() => {
    if (team) {
      dispatch(replaceTeamMembers(team));
    }
  }, [dispatch, team]);

  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredMembers = useMemo(() => {
    const query = search.trim().toLowerCase();

    return displayedMembers.filter((member) => {
      const matchesSearch =
        !query ||
        member.name.toLowerCase().includes(query) ||
        member.email.toLowerCase().includes(query);
      const matchesRole = roleFilter === "all" || member.role === roleFilter;
      const matchesStatus =
        statusFilter === "all" || member.status === statusFilter;

      return matchesSearch && matchesRole && matchesStatus;
    });
  }, [displayedMembers, roleFilter, search, statusFilter]);

  const totalCount = filteredMembers.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const safePage = Math.min(currentPage, totalPages);
  const pagedMembers = filteredMembers.slice(
    (safePage - 1) * pageSize,
    safePage * pageSize,
  );

  return (
    <>
      <div className="mb-2.5 flex items-start justify-between gap-4">
        <div className="relative">
          {isLoading && (
            <div className="absolute left-0 top-0 flex h-[18px] items-center gap-1.5">
              <span className="text-[14px] font-semibold leading-[18px]">
                Team members
              </span>
              <span className="text-[14px] font-semibold leading-[18px] text-[#718096]">
                ·
              </span>
              <Skeleton width={20} height={16} radius={4} />
            </div>
          )}
          <h2
            className={`m-0 text-[14px] font-semibold leading-[18px] ${isLoading ? "invisible" : ""}`}
          >
            Team members · {members.length}
          </h2>
          <p className="mt-0.5 text-xs leading-4 text-[#718096]">
            People with access to this employer account
          </p>
        </div>

        {isOwner ? <button
          type="button"
          className="inline-flex min-h-9 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-[#5a4bd1] bg-[#5b4ed0] px-3.5 text-xs font-bold text-white hover:bg-[#4f43bd]"
          onClick={() => dispatch(openInviteModal())}
        >
          <UserPlus className="h-3.5 w-3.5" strokeWidth={2} />
          Invite member
        </button> : null}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-72">
          <Search
            size={14}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#777f90]"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search team members"
            aria-label="Search team members"
            className="h-9 w-full rounded-lg border border-[#e1e5ea] bg-white pl-9 pr-3 text-xs text-[#151b2b] outline-none placeholder:text-[#8a919d] focus:border-[#b7b1ee] focus:ring-2 focus:ring-[#5b4fcf]/10"
          />
        </div>

        <AppSelect
          value={roleFilter}
          onChange={(value) => {
            setRoleFilter(value);
            setCurrentPage(1);
          }}
          options={ROLE_OPTIONS}
          ariaLabel="Filter team members by role"
          className="w-32"
        />

        <AppSelect
          value={statusFilter}
          onChange={(value) => {
            setStatusFilter(value);
            setCurrentPage(1);
          }}
          options={STATUS_OPTIONS}
          ariaLabel="Filter team members by status"
          className="w-32"
        />
      </div>

      <TableContainer
        aria-busy={isLoading}
        footer={
          !isLoading && !isError && totalCount > 0 && (
            <TablePagination
              currentPage={safePage}
              totalCount={totalCount}
              pageSize={pageSize}
              onPageChange={setCurrentPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setCurrentPage(1);
              }}
              itemLabel="members"
            />
          )
        }
      >
        {isLoading && <span className="sr-only">Loading team members...</span>}
        <Table className="min-w-[480px]" aria-label="Team members">
          <TableHeader>
            <TableRow>
              <TableHead>Member</TableHead>
              <TableHead className="w-[105px]">Role</TableHead>
              <TableHead className="w-[95px]">Status</TableHead>
              <TableHead className="w-[52px]">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <TableRow key={index}>
                  <TableCell>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Skeleton width={30} height={30} radius={8} />
                      <div className="min-w-0 flex-1">
                        <Skeleton width="55%" height={11} radius={6} />
                        <Skeleton className="mt-1.5" width="70%" height={9} radius={6} />
                      </div>
                    </div>
                  </TableCell>
                  <TableCell><Skeleton width={64} height={18} radius={999} /></TableCell>
                  <TableCell><Skeleton width={56} height={18} radius={999} /></TableCell>
                  <TableCell />
                </TableRow>
              ))
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={4} className="py-5">
                  <EmployerErrorState fallback="Unable to load team members. Please try again." />
                </TableCell>
              </TableRow>
            ) : filteredMembers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-5 text-xs text-[#718096]">
                  No team members match the selected filters.
                </TableCell>
              </TableRow>
            ) : pagedMembers.map((member) => (
              <TableRow key={member.id}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-lg bg-[#f2f4f6] text-[10px] font-bold text-[#526074]">
                      {initials(member.name)}
                    </div>
                    <div className="min-w-0">
                      <strong className="block truncate text-xs">{member.name}</strong>
                      {member.email && (
                        <small className="mt-0.5 block truncate text-[10px] text-[#718096]">
                          {member.email}
                        </small>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className={[
                    "inline-flex rounded-full px-2 py-1 text-[10px] font-bold",
                    member.role === "Owner"
                      ? "bg-[#edf1fb] text-[#34518e]"
                      : "bg-[#f2f4f6] text-[#5b6575]",
                  ].join(" ")}>
                    {member.role}
                  </span>
                </TableCell>
                <TableCell>
                  <span className={`text-[11px] ${member.status === "Active" ? "text-[#13875e]" : "text-[#5266a4]"}`}>
                    {member.status}
                  </span>
                </TableCell>
                <TableCell>
                  {member.canRemove && (
                    <>
                      <button
                        type="button"
                        aria-label={`Actions for ${member.name}`}
                        className="cursor-pointer border-0 bg-transparent text-[17px] text-[#4e5a6c]"
                        onClick={(event) => {
                          const rect = event.currentTarget.getBoundingClientRect();
                          setMenuPosition({
                            top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - (member.status === "Invited" ? 90 : 54))),
                            left: Math.max(8, rect.right - 145),
                          });
                          dispatch(toggleMemberMenu(member.id));
                        }}
                      >
                        <MoreVertical size={17} />
                      </button>
                      <MemberMenu memberId={member.id} status={member.status} position={menuPosition} />
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </>
  );
}

function MemberMenu({
  memberId,
  status,
  position,
}: {
  memberId: string;
  status: "Active" | "Invited";
  position: { top: number; left: number };
}) {
  const dispatch = useAppDispatch();
  const openId = useAppSelector(
    (state) => state.employerSettings.memberMenuOpenId,
  );

  useEffect(() => {
    if (openId !== memberId) return;
    const closeMenu = () => dispatch(toggleMemberMenu(memberId));
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [dispatch, memberId, openId]);

  if (openId !== memberId) return null;

  return createPortal(
    <div style={position} className="fixed z-50 w-[145px] rounded-lg border border-[#dfe4ea] bg-white p-1 shadow-[0_10px_28px_rgba(17,24,39,0.12)]">
      {status === "Invited" && (
        <button
          type="button"
          className="block w-full cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-[11px] hover:bg-[#f4f6f8]"
          onClick={() => dispatch(resendInvite(memberId))}
        >
          Resend invite
        </button>
      )}

      <button
        type="button"
        className="block w-full cursor-pointer rounded-md border-0 bg-transparent px-2.5 py-2 text-left text-[11px] text-[#c0392b] hover:bg-[#f4f6f8]"
        onClick={() => dispatch(askRemoveMember(memberId))}
      >
        Remove member
      </button>
    </div>,
    document.body,
  );
}
