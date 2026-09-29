"use client";

import { Dropdown } from "./dropdown";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectDropdownProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  containerClassName?: string;
  className?: string;
}

/*
 * A filter-bar select: the shared custom `Dropdown` at the 40px height and
 * rounded-xl shape the filter bars use. No portal renders a native <select>,
 * so every dropdown looks and behaves the same.
 */
export function SelectDropdown({
  options,
  value,
  onChange,
  ariaLabel,
  placeholder,
  disabled,
  containerClassName = "",
  className = "",
}: SelectDropdownProps) {
  return (
    <Dropdown
      value={value}
      options={options}
      onChange={onChange}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      width="w-full"
      className={containerClassName}
      buttonClassName={`h-[40px] rounded-xl border-[#dfe2e8] px-3.5 text-[13px] font-medium text-[#303747] hover:border-[#cfd3dc] focus:border-[#5b4fcf] focus:ring-[#5b4fcf]/20 ${className}`}
    />
  );
}
