"use client";

import { ImageTile } from "@/features/admin/shared/image-tile";

import Link from "next/link";

import { DataTable } from "@/components/ui/table";
import type { ColumnDef } from "@/components/ui/table";

import { StateBadge } from "../../shared/status-badge";

import type { UsersPagination, UserRow } from "../types";

interface CandidatesTabProps {
  users: UserRow[];
  isLoading?: boolean;
  onOpen: (id: string) => void;
  pagination: UsersPagination;
}

export function CandidatesTab({
  users,
  isLoading,
  onOpen,
  pagination,
}: CandidatesTabProps) {
  const columns: ColumnDef<UserRow>[] = [
    {
      id: "subject",
      header: "Candidate",
      headerClassName: "min-w-[320px]",
      cellClassName: "min-w-[320px]",
      cell: (user) => (
        <div className="flex min-w-0 items-center gap-3">
          <ImageTile src={user.imageUrl} initials={user.initials} fit={user.imageFit} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f0f2f5] text-[10px] font-bold text-[#172033]" />

          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-5 text-[#172033]">
              {user.name}
            </p>

            <p className="truncate text-[11px] leading-4 text-[#7b8494]">
              {user.meta}
            </p>
          </div>
        </div>
      ),
    },

    {
      id: "identifier",
      header: "Contact",
      headerClassName: "min-w-[185px]",
      cellClassName:
        "min-w-[185px] whitespace-nowrap text-[12px] text-[#344054]",
      cell: (user) => user.identifier,
    },

    {
      id: "state",
      header: "State",
      headerClassName: "min-w-[135px]",
      cellClassName: "min-w-[135px]",
      cell: (user) => (
        <StateBadge state={user.state} />
      ),
    },

    {
      id: "joined",
      header: "Joined",
      headerClassName: "min-w-[135px]",
      cellClassName:
        "min-w-[135px] whitespace-nowrap text-[12px] text-[#7b8494]",
      cell: (user) => user.joined,
    },

    {
      id: "actions",
      header: "Actions",
      headerClassName: "min-w-[100px]",
      cellClassName: "min-w-[100px]",
      cell: (user) => (
        <Link
          href={`/admin/users/${user.id}`}
          className="cursor-pointer rounded-lg border border-[#e2e5eb] bg-white px-3 py-2 text-[11px] font-semibold text-[#172033] transition-colors hover:bg-[#f8f9fb]"
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <DataTable<UserRow>
      columns={columns}
      data={users}
      keyExtractor={(user) => user.id}
      paginationMode="cursor"
      pageSize={pagination.pageSize}
      currentPage={pagination.currentPage}
      hasNextPage={pagination.hasNextPage}
      onNextPage={pagination.onNextPage}
      onPreviousPage={pagination.onPreviousPage}
      onPageSizeChange={pagination.onPageSizeChange}
      itemLabel="candidates"
      emptyTitle="No candidates found"
      emptySubtitle="Try a different name in the search box above."
      isLoading={isLoading}
    />
  );
}
