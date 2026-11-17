"use client";
import { useState, useEffect } from "react";
import { AppSelect } from "@/components/ui/app-select";
import { baseApi } from "@/store/api/base-api";
import type { CareerDetails } from "./career-api";
import { chooseEducation, educationPath, educationState, writeEducationText, type EducationKey, type EducationOption, autoNAOption } from "./education-state";
import { fieldClass } from "@/features/student/onboarding/components/ui";

const api = baseApi.injectEndpoints({ endpoints: (builder) => ({
  getEducationOptions: builder.query<{items: EducationOption[]}, string>({
    async queryFn(path, _api, _extra, baseQuery) {
      const items: EducationOption[] = [];
      for (;;) {
        const response = await baseQuery(`${path}${path.includes("?") ? "&" : "?"}offset=${items.length}`);
        if (response.error) return {error: response.error};
        const page = response.data as {items: EducationOption[]; has_more: boolean};
        items.push(...page.items);
        if (!page.has_more || !page.items.length) return {data: {items}};
      }
    }, keepUnusedDataFor: 30,
  }),
}) });

export function EducationField({ fieldKey, details, onChange, label, id, invalid = false, compact = false }: {
  fieldKey: EducationKey; details: CareerDetails; onChange: (details: CareerDetails) => void;
  label: string; id?: string; invalid?: boolean; compact?: boolean;
}) {
  const state = educationState(details, fieldKey);
  const [query, setQuery] = useState("");
  const { currentData, isFetching, isError, refetch } = api.useGetEducationOptionsQuery(
    educationPath(fieldKey, state.parentId), { skip: state.disabled || state.freeText, refetchOnMountOrArgChange: true, refetchOnFocus: true });
  const items = currentData?.items ?? [];
  const matches = items.filter((item) => item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const duplicate = state.other && items.find((item) => item.name.trim().toLocaleLowerCase() === String(details[fieldKey] || "").trim().toLocaleLowerCase());
  const choose = (value: string) => onChange(chooseEducation(details, fieldKey, value === "__other__" ? "other" : items.find((item) => item.id === value) || null));
  return <div className="space-y-2">
    {!state.freeText && <AppSelect id={id} ariaLabel={label} ariaInvalid={invalid} ariaDescribedBy={invalid && id ? `${id}-error` : undefined}
      className={`[&>button]:h-[54px] [&>button]:rounded-[16px] [&>button]:border-[1.5px] [&>button]:px-4 [&>button>span]:font-medium ${compact ? "[&>button]:!h-10 [&>button]:!rounded-lg [&>button]:!border [&>button]:!px-3" : ""}`}
      variant={compact ? "student-compact" : "student"} menuPlacement="auto" portal searchable pinnedOptionValues={["__other__"]} onSearchChange={setQuery} searchPlaceholder={`Search ${label.toLowerCase()}`}
      value={state.other ? "__other__" : state.id} selectedLabel={state.id ? String(details[fieldKey] || "") : undefined}
      disabled={state.disabled} isSearching={isFetching} loadingMessage="Loading options..."
      placeholder={state.disabled ? "Choose the preceding field first" : "Select"}
      options={[{value: "", label: "Select"}, ...matches.map((item) => ({value: item.id, label: item.name})), {value: "__other__", label: "Others"}]}
      onOpenChange={(open) => {if (open && !state.disabled) void refetch();}} onChange={choose} />}
    {(state.other || state.freeText) && <input id={state.freeText ? id : `${id}-other`} aria-label={`Other ${label}`} required maxLength={160}
      className={fieldClass} placeholder={`Enter ${label.toLowerCase()}`} value={String(details[fieldKey] || "")}
      onChange={(event) => onChange(writeEducationText(details, fieldKey, event.target.value))} />}
    {duplicate && <p className="text-sm text-[#5F4DB2]">This option already exists. <button type="button" className="underline" onClick={() => choose(duplicate.id)}>Choose {duplicate.name}</button></p>}
    {isError && !state.freeText && <p role="alert" className="text-sm text-red-700">Options could not be refreshed. <button type="button" onClick={() => refetch()} className="underline">Retry</button></p>}
    {!isFetching && !isError && !state.disabled && !state.freeText && !items.length && <p className="text-sm text-[#5F6B80]">No options yet. Choose Others to enter your answer.</p>}
  </div>;
}

export function useEducationAutoNA(details: CareerDetails | null, onChange: (details: CareerDetails) => void): boolean {
  const state = details ? educationState(details, "specialization") : null;
  const path = educationPath("specialization", state?.parentId || "");
  const {currentData} = api.useGetEducationOptionsQuery(path, {skip: !state || state.disabled || state.freeText, refetchOnMountOrArgChange: true, refetchOnFocus: true});
  const option = details && state && !state.freeText ? autoNAOption(currentData?.items ?? [], details) : null;
  useEffect(() => {
    if (details && option && !details.specialization_id) onChange(chooseEducation(details, "specialization", option));
  }, [details, option, onChange]);
  return Boolean(option);
}
