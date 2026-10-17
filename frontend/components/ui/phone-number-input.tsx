"use client";

import { useState } from "react";
import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js";

import { AppSelect } from "./app-select";

const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const countries = getCountries();
const countryOptions = countries
  .map((country) => ({
    value: country,
    label: `${regionNames.of(country) ?? country} (+${getCountryCallingCode(country)})`,
  }))
  .sort((a, b) => a.label.localeCompare(b.label));

function countryFromValue(value: string): CountryCode | undefined {
  if (!value.startsWith("+")) return undefined;
  const parsed = parsePhoneNumberFromString(value);
  if (parsed?.country) return parsed.country;
  const digits = value.slice(1).replace(/\D/g, "");
  return countries
    .filter((country) => digits.startsWith(getCountryCallingCode(country)))
    .sort((a, b) => getCountryCallingCode(b).length - getCountryCallingCode(a).length)[0];
}

function nationalFromValue(value: string, country: CountryCode): string {
  const digits = value.replace(/\D/g, "");
  const dialCode = getCountryCallingCode(country);
  return value.trim().startsWith("+") && digits.startsWith(dialCode)
    ? digits.slice(dialCode.length)
    : digits;
}

interface PhoneNumberInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  inputClassName?: string;
  variant?: "default" | "student" | "student-compact";
  placeholder?: string;
  ariaLabel?: string;
  ariaInvalid?: boolean;
  ariaDescribedBy?: string;
  disabled?: boolean;
  onBlur?: () => void;
  /** These forms currently publish an India-only rule from the server. */
  indiaOnly?: boolean;
}

/** Keeps the wire value in E.164 shape while editing the country and local digits separately. */
export function PhoneNumberInput({
  id,
  value,
  onChange,
  inputClassName = "",
  variant = "default",
  placeholder = "Mobile number",
  ariaLabel = "Mobile number",
  ariaInvalid,
  ariaDescribedBy,
  disabled,
  onBlur,
  indiaOnly = false,
}: Readonly<PhoneNumberInputProps>) {
  const [selection, setSelection] = useState(() => {
    const initialCountry = countryFromValue(value) ?? ("IN" as CountryCode);
    return { value, country: initialCountry, national: nationalFromValue(value, initialCountry) };
  });
  const country = selection.value === value
    ? selection.country
    : countryFromValue(value) ?? selection.country;

  const dialCode = getCountryCallingCode(country);
  const isStudent = variant !== "default";
  const national = selection.value === value
    ? selection.national
    : nationalFromValue(value, country);

  function emit(nextCountry: CountryCode, nextNational: string) {
    // The library removes country-specific trunk prefixes (for example the
    // leading 0 in a UK national number) once enough digits are present.
    const parsed = parsePhoneNumberFromString(nextNational, nextCountry);
    const next = nextNational
      ? parsed?.isPossible()
        ? parsed.number
        : `+${getCountryCallingCode(nextCountry)}${nextNational}`
      : "";
    setSelection({ value: next, country: nextCountry, national: nextNational });
    onChange(next);
  }

  return (
    <div>
      <div className={`flex min-w-0 w-full items-stretch overflow-hidden border bg-white transition-colors focus-within:ring-2 ${
        ariaInvalid
          ? "border-[#b42318] focus-within:ring-[#b42318]/10"
          : isStudent
            ? "border-[#E7E0D4] focus-within:border-[#5F4DB2] focus-within:ring-[#5F4DB2]/10"
            : "border-[#dfe2e8] focus-within:border-[#3566b8] focus-within:ring-[#3566b8]/10"
      } ${variant === "student" ? "rounded-[16px] border-[1.5px]" : variant === "student-compact" ? "rounded-lg border-[1.5px]" : "rounded-[10px]"}`}>
        <AppSelect
          value={country}
          onChange={(next) => {
            const selected = next as CountryCode;
            emit(selected, national);
          }}
          options={countryOptions}
          searchable
          searchPlaceholder="Search country or code"
          ariaLabel="Country dialing code"
          selectedLabel={`+${dialCode}`}
          scrollToSelectedOnOpen
          variant={isStudent ? "student-compact" : "default"}
          portal
          portalMenuMinWidth={320}
          disabled={disabled}
          className={`w-[104px] shrink-0 border-r ${isStudent ? "border-[#E7E0D4]" : "border-[#dfe2e8]"} [&>button]:!h-full [&>button]:!min-h-[44px] [&>button]:!rounded-none [&>button]:!border-0 [&>button]:!bg-transparent [&>button]:!px-3 [&>button]:!shadow-none [&>button]:focus-visible:!ring-0 [&>button>span]:!text-[14px]`}
        />
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          value={national}
          onChange={(event) => emit(country, event.target.value.replace(/\D/g, "").slice(0, 15))}
          onBlur={onBlur}
          disabled={disabled}
          aria-label={ariaLabel}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          placeholder={placeholder}
          className={`min-w-0 !w-auto flex-1 !rounded-none !border-0 !bg-transparent !shadow-none focus:!ring-0 ${inputClassName}`}
        />
      </div>
      {indiaOnly && country !== "IN" && (
        <p className="mt-1.5 text-xs text-[#b42318]" role="status">
          This form currently accepts Indian mobile numbers only.
        </p>
      )}
    </div>
  );
}
