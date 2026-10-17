"use client";

import { AppSelect } from "@/components/ui/app-select";

const months = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
].map((label, index) => ({ value: String(index + 1).padStart(2, "0"), label }));

const currentYear = new Date().getFullYear();
const years = [
  ...Array.from({ length: currentYear - 1899 }, (_, index) => String(currentYear - index)),
  ...Array.from({ length: Math.max(0, 2100 - currentYear) }, (_, index) => String(currentYear + index + 1)),
];

interface PartialDateSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
}

export function PartialDateSelect({ label, value, onChange, invalid = false, describedBy }: Readonly<PartialDateSelectProps>) {
  const year = /^\d{4}/.exec(value)?.[0] ?? "";
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.exec(value)?.[1] ?? "";
  const yearOptions = year && !years.includes(year) ? [year, ...years] : years;
  const selectClass = "[&>button]:h-[52px] [&>button]:rounded-[16px] [&>button]:px-4 lg:[&>button]:h-[42px] lg:[&>button]:rounded-[12px] lg:[&>button]:px-3.5 lg:[&>button>span]:text-[14px]";

  return (
    <div className="grid min-w-0 grid-cols-2 gap-2">
      <AppSelect
        value={year}
        onChange={(next) => onChange(next ? `${next}${month ? `-${month}` : ""}` : "")}
        options={[{ value: "", label: "Year" }, ...yearOptions.map((option) => ({ value: option, label: option }))]}
        placeholder="Year"
        ariaLabel={`${label} year`}
        ariaInvalid={invalid}
        ariaDescribedBy={describedBy}
        searchable
        searchPlaceholder="Search year"
        scrollToSelectedOnOpen
        variant="student"
        menuPlacement="auto"
        portal
        className={selectClass}
      />
      <AppSelect
        value={month}
        onChange={(next) => onChange(next ? `${year}-${next}` : year)}
        options={[{ value: "", label: "Month" }, ...months]}
        placeholder="Month"
        ariaLabel={`${label} month`}
        ariaInvalid={invalid}
        ariaDescribedBy={describedBy}
        disabled={!year}
        variant="student"
        menuPlacement="auto"
        portal
        className={selectClass}
      />
    </div>
  );
}
