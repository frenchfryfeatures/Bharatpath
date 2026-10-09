"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { usePageHeader } from "@/components/layout/header-context";
import { ErrorState, SelectDropdown } from "@/components/ui";
import { DataTable, type ColumnDef } from "@/components/ui/table";
import {
  type DiscountAudience,
  type DiscountCode,
  useGetAdminDiscountCodesQuery,
  useGetAdminIdentityQuery,
} from "@/store/api/admin-api";

import { CodeDrawer } from "./code-drawer";
import { CreateCodeDrawer } from "./create-code-drawer";
import { AUDIENCE_LABEL, formatDate, valueLabel } from "./format";

const AUDIENCE_FILTER = [
  { value: "", label: "All audiences" },
  { value: "CANDIDATE", label: "Candidates" },
  { value: "EMPLOYER", label: "Employers" },
  { value: "COLLEGE", label: "Colleges" },
];

const STATUS_STYLE: Record<DiscountCode["status"], string> = {
  ACTIVE: "bg-[#eef7f1] text-[#2f7b4b]",
  SCHEDULED: "bg-[#eef0ff] text-[#385da8]",
  EXPIRED: "bg-[#f0f2f5] text-[#687182]",
  EXHAUSTED: "bg-[#fff5df] text-[#9a6b18]",
  DISABLED: "bg-[#fff0f0] text-[#b43e45]",
};

export function DiscountCodesPage() {
  usePageHeader("Discount codes", "Create promotions and investigate successful redemptions");

  const [audience, setAudience] = useState<DiscountAudience | "">("");
  const [pageSize, setPageSize] = useState(10);
  // cursors[n] is the cursor that loads page n + 1; page 1 has none.
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const page = cursors.length;
  const { data: identity } = useGetAdminIdentityQuery();
  const canWrite = identity?.role === "PLATFORM_ADMIN";
  const { data, isLoading, isFetching, error } = useGetAdminDiscountCodesQuery({
    audience: audience || undefined,
    limit: pageSize,
    cursor: cursors[page - 1],
  });

  const resetPaging = () => setCursors([undefined]);
  const items = data?.items ?? [];
  // Read the open code from the list so a disable shows without a re-open.
  const selected = items.find((code) => code.id === selectedId) ?? null;

  const columns: ColumnDef<DiscountCode>[] = [
    {
      id: "code",
      header: "Code",
      headerClassName: "min-w-[220px]",
      cellClassName: "min-w-[220px]",
      cell: (code) => (
        <div className="min-w-0">
          <p className="truncate font-mono text-[13px] font-semibold text-[#172033]">{code.code}</p>
          <p className="truncate text-[11px] leading-4 text-[#7b8494]">{code.label || "No label"}</p>
        </div>
      ),
    },
    {
      id: "audience",
      header: "Audience",
      headerClassName: "min-w-[120px]",
      cellClassName: "min-w-[120px] whitespace-nowrap text-[12px] text-[#344054]",
      cell: (code) => AUDIENCE_LABEL[code.audience],
    },
    {
      id: "discount",
      header: "Discount",
      headerClassName: "min-w-[120px]",
      cellClassName: "min-w-[120px] whitespace-nowrap text-[12px] font-semibold text-[#172033]",
      cell: (code) => valueLabel(code),
    },
    {
      id: "uses",
      header: "Uses",
      headerClassName: "min-w-[100px]",
      cellClassName: "min-w-[100px] whitespace-nowrap text-[12px] text-[#344054]",
      cell: (code) => `${code.usage_count} / ${code.usage_limit ?? "∞"}`,
    },
    {
      id: "validity",
      header: "Validity",
      headerClassName: "min-w-[200px]",
      cellClassName: "min-w-[200px] whitespace-nowrap text-[12px] text-[#7b8494]",
      cell: (code) => (
        <>
          {formatDate(code.valid_from)}
          <br />
          to {code.valid_until ? formatDate(code.valid_until) : "no end date"}
        </>
      ),
    },
    {
      id: "status",
      header: "Status",
      headerClassName: "min-w-[110px]",
      cellClassName: "min-w-[110px]",
      cell: (code) => (
        <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold ${STATUS_STYLE[code.status]}`}>
          {code.status.charAt(0) + code.status.slice(1).toLowerCase()}
        </span>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      headerClassName: "min-w-[100px]",
      cellClassName: "min-w-[100px]",
      cell: (code) => (
        <button
          type="button"
          onClick={() => setSelectedId(code.id)}
          className="cursor-pointer rounded-lg border border-[#e2e5eb] bg-white px-3 py-2 text-[11px] font-semibold text-[#172033] transition-colors hover:bg-[#f8f9fb]"
        >
          View
        </button>
      ),
    },
  ];

  return (
    <div className="min-w-0 space-y-0">
      <div className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="w-full sm:w-[220px]">
          <SelectDropdown
            value={audience}
            onChange={(value) => {
              setAudience(value as DiscountAudience | "");
              resetPaging();
            }}
            options={AUDIENCE_FILTER}
            ariaLabel="Filter by audience"
            className="h-[38px] rounded-lg text-[12px]"
          />
        </div>

        {canWrite ? (
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="inline-flex h-[38px] cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#151b2b] px-4 text-[12px] font-semibold text-white transition-colors hover:bg-[#20283d]"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create code
          </button>
        ) : null}
      </div>

      {error ? <ErrorState error={error} fallback="Discount codes could not be loaded." className="mb-3" /> : null}

      <DataTable<DiscountCode>
        columns={columns}
        data={items}
        keyExtractor={(code) => code.id}
        paginationMode="cursor"
        pageSize={pageSize}
        currentPage={page}
        hasNextPage={Boolean(data?.next_cursor)}
        onNextPage={() => data?.next_cursor && setCursors((current) => [...current, data.next_cursor ?? undefined])}
        onPreviousPage={() => setCursors((current) => current.slice(0, -1))}
        onPageSizeChange={(size) => {
          setPageSize(size);
          resetPaging();
        }}
        itemLabel="codes"
        emptyTitle="No discount codes found"
        emptySubtitle=""
        isLoading={isLoading || isFetching}
      />

      {data?.policy_version ? (
        <p className="pt-3 text-[11px] text-[#7b8494]">Policy version: {data.policy_version}</p>
      ) : null}

      {createOpen ? <CreateCodeDrawer onClose={() => setCreateOpen(false)} /> : null}
      {selected ? (
        <CodeDrawer code={selected} canWrite={canWrite} onClose={() => setSelectedId(null)} />
      ) : null}
    </div>
  );
}
