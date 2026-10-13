"use client";

import { useState } from "react";
import { CollegeLogoCard } from "./college-logo-card";

import { BadgeCheck, Loader2 } from "lucide-react";

import { Skeleton } from "@/components/common/loading";
import { Dropdown } from "@/components/ui/dropdown";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { showFormError } from "@/lib/feedback/form-error";

import { useSettings } from "../hooks/use-settings";
import { INSTITUTION_TYPE_OPTIONS } from "../types";

const institutionTypeOptions = [
  { value: "", label: "Select a type" },
  ...INSTITUTION_TYPE_OPTIONS.map((option) => ({
    value: option.code,
    label: option.label,
  })),
];

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function CollegeProfile() {
  const [nameError, setNameError] = useState("");
  const {
    organisation,
    isLoadingProfile,
    draftName,
    setDraftName,
    draftInstitutionType,
    setDraftInstitutionType,
    saveProfile,
    isSavingProfile,
  } = useSettings("profile");

  const submit = async () => {
    const name = draftName.trim();
    if (name.length < 2 || name.length > 255) {
      setNameError(name.length < 2 ? "Enter at least 2 characters." : "Use 255 characters or fewer.");
      showFormError("Check the highlighted institution name.", { portal: "college", fieldId: "college-profile-name" });
      return;
    }
    try {
      await saveProfile();
    } catch (error) {
      showFormError(getApiErrorMessage(error, "We could not save the college profile."), { portal: "college" });
    }
  };

  if (isLoadingProfile) {
    return (
      <section
        aria-busy="true"
        className="flex w-full max-w-[640px] flex-col gap-4 rounded-[12px] border border-[#e1e5eb] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.024)]"
      >
        <div className="flex flex-col gap-2">
          <Skeleton width={140} height={16} radius={6} />
          <Skeleton width={280} height={12} radius={6} />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton width={120} height={12} radius={6} />
          <Skeleton height={46} radius={10} />
        </div>
        <div className="flex flex-col gap-2">
          <Skeleton width={120} height={12} radius={6} />
          <Skeleton height={46} radius={10} />
        </div>
        <Skeleton width={132} height={40} radius={8} />
      </section>
    );
  }

  return (
    <section
      className="flex w-full max-w-[640px] flex-col gap-4 rounded-[12px] border border-[#e1e5eb] bg-white p-5 shadow-[0_4px_12px_rgba(19,26,38,0.024)]"
      style={{
        fontFamily: "'General Sans', sans-serif",
      }}
    >
      {/* Header */}
      <div className="flex flex-col gap-[2px]">
        <h2 className="text-[14px] font-semibold leading-[18px] text-[#131A26]">
          College profile
        </h2>

        <p className="text-[12px] font-normal leading-[17px] text-[#64748b]">
          Shown to employers alongside your students&apos; verified scores.
        </p>
      </div>

      <CollegeLogoCard />

      {/* Institution name */}
      <label className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold leading-[17px] text-[#131A26]">
          Institution name
        </span>

        <input
          id="college-profile-name"
          type="text"
          value={draftName}
          placeholder="Sinhgad Technical Education Society"
          aria-label="Institution name"
          aria-invalid={Boolean(nameError)}
          aria-describedby={nameError ? "college-profile-name-error" : undefined}
          onChange={(event) => { setDraftName(event.target.value); setNameError(""); }}
          className={`w-full rounded-[10px] border bg-white px-4 py-3 text-[14px] font-medium leading-5 text-[#131A26] outline-none transition placeholder:text-[#64748b] focus:border-[#3566b8] focus:ring-2 focus:ring-[#3566b8]/10 ${nameError ? "border-[#c43d3d]" : "border-[#e1e5eb]"}`}
        />
        {nameError && <span id="college-profile-name-error" className="text-xs text-[#c43d3d]">{nameError}</span>}
      </label>

      {/* Institution type */}
      <div className="flex flex-col gap-2">
        <span className="text-[13px] font-semibold leading-[17px] text-[#131A26]">
          Institution type
        </span>

        <Dropdown
          value={draftInstitutionType ?? ""}
          options={institutionTypeOptions}
          placeholder="Select a type"
          onChange={(value) =>
            setDraftInstitutionType(value || null)
          }
          ariaLabel="Institution type"
          width="w-full"
          buttonClassName="h-[46px] rounded-[10px] border-[#e1e5eb] px-4 text-[14px] font-medium leading-5 text-[#131A26] focus:border-[#3566b8] focus:ring-[#3566b8]/10"
        />
      </div>

      {/* Verification */}
      {organisation?.verifiedAt && (
        <div className="flex items-center gap-[10px] rounded-[10px] bg-[#eaf6f0] px-4 py-3">
          <BadgeCheck
            size={16}
            strokeWidth={2}
            className="shrink-0 text-[#00845a]"
          />

          <span className="flex-1 text-[12px] font-medium leading-4 text-[#00845a]">
            Institution verified on {formatDate(organisation.verifiedAt)}
          </span>
        </div>
      )}

      {/* Save */}
      <button
        type="button"
        disabled={isSavingProfile}
        onClick={() => void submit()}
        aria-busy={isSavingProfile || undefined}
        className="inline-flex items-center justify-center gap-1.5 self-start rounded-[8px] border-0 bg-[#5a4bd6] px-4 py-[10px] text-[13px] font-semibold leading-[17px] text-white transition hover:bg-[#4f41c8] disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSavingProfile && (
          <Loader2 aria-hidden="true" size={14} className="animate-spin" />
        )}
        {isSavingProfile ? "Saving..." : "Save changes"}
      </button>
    </section>
  );
}
