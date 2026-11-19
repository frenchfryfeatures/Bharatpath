"use client";

import { monthYearOptions } from "@/lib/ui/month-year-options";
import { useState } from "react";

import { AppSelect } from "./app-select";

const monthNames = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function partsFromValue(value: string) {
  const match = /^(19|20)\d{2}-(0[1-9]|1[0-2])$/.exec(value);
  return { year: match ? value.slice(0, 4) : "", month: match?.[2] ?? "" };
}

interface MonthYearSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  describedBy?: string;
  compact?: boolean;
  after?: string;
  disabled?: boolean;
}

export function MonthYearSelect({
  id,
  label,
  value,
  onChange,
  invalid = false,
  describedBy,
  compact = false,
  after = "",
  disabled = false,
}: Readonly<MonthYearSelectProps>) {
  const [selection, setSelection] = useState(() => ({ baseValue: value, baseAfter: after, ...partsFromValue(value) }));
  const { month, year } = selection.baseValue === value && selection.baseAfter === after ? selection : partsFromValue(value);
  const choices = monthYearOptions(year, after);
  const commit = (nextMonth: string, nextYear: string) => {
    const validMonths = monthYearOptions(nextYear, after).months;
    const month = validMonths.includes(nextMonth) ? nextMonth : "";
    const nextValue = month && nextYear ? `${nextYear}-${month}` : "";
    setSelection({ baseValue: nextValue, baseAfter: after, month, year: nextYear });
    if (nextValue !== value) onChange(nextValue);
  };
  const monthOptions = monthNames
    .map((name, index) => ({value: String(index + 1).padStart(2, "0"), label: name}))
    .filter((option) => choices.months.includes(option.value));
  const yearOptions = choices.years.map((year) => ({value: year, label: year}));
  const selectClass = `[&>button]:h-[54px] [&>button]:rounded-[16px] [&>button]:border-[1.5px] [&>button]:px-4 [&>button>span]:font-medium ${compact ? "[&>button]:!h-10 [&>button]:!rounded-lg [&>button]:!border [&>button]:!px-3" : ""} ${invalid ? "[&>button]:!border-[#993A22]" : ""}`;

  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-3">
        <AppSelect
          id={id}
          disabled={disabled || !choices.years.length}
          value={month}
          onChange={(nextMonth) => commit(nextMonth, year)}
          options={monthOptions}
          placeholder="Month"
          ariaLabel={`${label} month`}
          ariaInvalid={invalid}
          ariaDescribedBy={describedBy}
          variant={compact ? "student-compact" : "student"}
          menuPlacement="auto"
          portal
          className={selectClass}
        />
        <AppSelect
          id={`${id}-year`}
          disabled={disabled || !choices.years.length}
          value={year}
          onChange={(nextYear) => commit(month, nextYear)}
          options={yearOptions}
          placeholder="Year"
          ariaLabel={`${label} year`}
          ariaInvalid={invalid}
          ariaDescribedBy={describedBy}
          variant={compact ? "student-compact" : "student"}
          menuPlacement="auto"
          portal
          scrollToSelectedOnOpen
          className={selectClass}
        />
      </div>
      {(value || month || year) && (
        <button type="button" onClick={() => commit("", "")} className="text-xs font-medium text-[#5F4DB2] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F4DB2]">
          Clear date
        </button>
      )}
    </div>
  );
}
