"use client";

import { Loader2 } from "lucide-react";

import { AppSelect } from "@/components/ui/app-select";

interface ApplicationFilterProps {
  value: string;
  total: number;
  loadedTotal: number;
  pageSize: number;
  hasNextPage: boolean;
  isLoadingMore: boolean;
  options: { value: string; label: string }[];
  search: string;
  isSearching: boolean;
  isLoadingMoreJobOptions: boolean;
  jobOptionsHaveMore: boolean;
  onChange: (value: string) => void;
  onSearchChange: (value: string) => void;
  onJobMenuOpenChange: (open: boolean) => void;
  onLoadMoreJobOptions: () => void;
  onLoadMore: () => void;
}

export function ApplicationFilter({
  value,
  total,
  loadedTotal,
  pageSize,
  hasNextPage,
  isLoadingMore,
  options,
  search,
  isSearching,
  isLoadingMoreJobOptions,
  jobOptionsHaveMore,
  onChange,
  onSearchChange,
  onJobMenuOpenChange,
  onLoadMoreJobOptions,
  onLoadMore,
}: ApplicationFilterProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <AppSelect
          value={value}
          onChange={onChange}
          options={options}
          className="w-[222px]"
          searchable
          searchPlaceholder="Search jobs"
          onSearchChange={onSearchChange}
          isSearching={isSearching}
          loadingMessage={search.length > 0 ? "Searching..." : "Loading jobs..."}
          noOptionsMessage="No jobs found"
          onOpenChange={onJobMenuOpenChange}
          hasMoreOptions={jobOptionsHaveMore}
          onLoadMoreOptions={onLoadMoreJobOptions}
          isLoadingMoreOptions={isLoadingMoreJobOptions}
        />

        <span
          className="text-[12px] font-medium text-[#777f90]"
          aria-live="polite"
        >
          {value === "all"
            ? `${loadedTotal} ${
                loadedTotal === 1 ? "application" : "applications"
              } loaded`
            : `${total} matching ${
                total === 1 ? "application" : "applications"
              } from ${loadedTotal} loaded`}
          {hasNextPage
            ? "; more organisation applications are available"
            : "; all available applications are loaded"}
        </span>
      </div>

      {hasNextPage ? (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={isLoadingMore}
          className="
            inline-flex
            min-h-9
            items-center
            justify-center
            gap-2
            rounded-lg
            border
            border-[#d6dce5]
            bg-white
            px-3
            text-[12px]
            font-semibold
            text-[#315f9b]
            transition-colors
            hover:bg-[#f1f5fb]
            disabled:cursor-not-allowed
            disabled:opacity-60
          "
        >
          {isLoadingMore ? (
            <>
              <Loader2 aria-hidden="true" size={14} className="animate-spin" />
              Loading applicants
            </>
          ) : (
            `Load next ${pageSize}`
          )}
        </button>
      ) : null}
    </div>
  );
}