"use client";

import React from "react";
import { SearchInput } from "@/components/ui/search-input";
import { AppSelect } from "@/components/ui/app-select";
import type { StudentStatus } from "./types";

export interface StudentFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  status: StudentStatus | "all";
  onStatusChange: (status: StudentStatus | "all") => void;
}

const STATUS_OPTIONS = [
  { value: "all", label: "All link states" },
  { value: "linked", label: "Linked" },
  { value: "invited", label: "Invited" },
  { value: "consent_pending", label: "Consent pending" },
];

export function StudentFilters({
  search,
  onSearchChange,
  status,
  onStatusChange,
}: Readonly<StudentFiltersProps>) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <SearchInput
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        onClear={() => onSearchChange("")}
        placeholder="Search by student name"
        containerClassName="w-full sm:w-[320px]"
      />

      <AppSelect
        options={STATUS_OPTIONS}
        value={status}
        onChange={(value) =>
          onStatusChange(value as StudentStatus | "all")
        }
        ariaLabel="Filter students by link state"
        className="w-full sm:w-42.5 [&>button]:h-10 [&>button]:rounded-xl [&>button]:px-3.5"
        menuClassName="min-w-[170px]"
      />
    </div>
  );
}
