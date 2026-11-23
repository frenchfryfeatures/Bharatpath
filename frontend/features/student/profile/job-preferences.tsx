"use client";

/**
 * The profile's Preferences tab (2026-11-23): what the candidate wants from
 * their next job, read by the job engine to rank "Jobs that fit your
 * profile". Built from the onboarding form's own pieces -- `Field`,
 * `fieldClass`, the student `AppSelect` and `PillButton` -- so it looks and
 * behaves like onboarding.
 *
 * Every choice with a known list is a dropdown showing all its options;
 * lists that take several answers add each pick as a removable chip, as the
 * onboarding "preferred work locations" field does.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, X } from "lucide-react";

import { AppSelect } from "@/components/ui/app-select";
import { FormSkeleton } from "@/components/common/loading";
import { CityDatalist } from "@/features/student/components/city-datalist";
import { Field, fieldBorder, fieldClass, PillButton } from "@/features/student/onboarding/components/ui";
import { showErrorFeedback, showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { StudentPage } from "@/features/student/shell";
import { formatSalaryInput } from "../salary-input";
import { parseSalaryLpa, salaryInputFromRupees } from "../salary";
import {
  type JobPreferenceOptions,
  type JobPreferences,
  type PreferenceOption,
  useGetJobPreferenceOptionsQuery,
  useGetJobPreferencesQuery,
  useSaveJobPreferencesMutation,
} from "./career-api";

const MAX_CHOICES = 5;
const selectClass =
  "[&>button]:h-[54px] [&>button]:rounded-[16px] [&>button]:border-[1.5px] [&>button]:px-4 [&>button>span]:font-medium";

function pick(source: JobPreferences): JobPreferences {
  return {
    preferred_roles: source.preferred_roles,
    preferred_industries: source.preferred_industries,
    work_modes: source.work_modes,
    job_types: source.job_types,
    open_to_relocation: source.open_to_relocation,
    preferred_locations: source.preferred_locations,
    preferred_salary: source.preferred_salary,
    preferred_salary_currency: source.preferred_salary_currency,
  };
}

/** A dropdown of every option; each pick becomes a removable chip. */
function MultiSelectField({
  id,
  label,
  hint,
  options,
  values,
  onChange,
  searchable = false,
  labelFor,
}: {
  id: string;
  label: string;
  hint?: string;
  options: PreferenceOption[];
  values: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
  labelFor?: (value: string) => string;
}) {
  const remaining = options.filter((option) => !values.includes(option.value));
  const full = values.length >= MAX_CHOICES || remaining.length === 0;
  return (
    <Field id={id} label={label} hint={full && values.length >= MAX_CHOICES ? `Up to ${MAX_CHOICES}.` : hint}>
      <AppSelect
        id={id}
        value=""
        disabled={full}
        placeholder={full ? "All chosen" : "Select"}
        options={remaining}
        onChange={(value) => value && onChange([...values, value])}
        ariaLabel={label}
        menuPlacement="auto"
        portal
        searchable={searchable}
        searchPlaceholder={`Search ${label.toLowerCase()}`}
        variant="student"
        className={selectClass}
      />
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`Selected ${label.toLowerCase()}`}>
          {values.map((value) => (
            <li
              key={value}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#C9BEEB] bg-[#F1EAF7] py-1.5 pl-3 pr-1.5 text-[13px] font-semibold text-[#4A3E8F]"
            >
              {labelFor ? labelFor(value) : value}
              <button
                type="button"
                aria-label={`Remove ${labelFor ? labelFor(value) : value}`}
                onClick={() => onChange(values.filter((item) => item !== value))}
                className="grid h-6 w-6 place-items-center rounded-full hover:bg-white/70"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

export function JobPreferencesForm({ onOpenProfile }: { onOpenProfile?: () => void }) {
  const preferences = useGetJobPreferencesQuery();
  const options = useGetJobPreferenceOptionsQuery();

  if (preferences.isLoading || options.isLoading) {
    return <FormSkeleton />;
  }
  // An older server has no preferences endpoints yet (404): say so plainly.
  const missing = [preferences.error, options.error].some(
    (error) => typeof error === "object" && error !== null && "status" in error && error.status === 404,
  );
  if (missing) {
    return (
      <section className="rounded-[20px] border border-[#E7E0D4] bg-white p-6 text-center">
        <h2 className="text-[16px] font-semibold text-[#0A1931]">Coming in the next update</h2>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-5 text-[#5F6B80]">
          Job preferences are not available on this server yet. Your profile and recommended jobs
          work as usual.
        </p>
      </section>
    );
  }
  if (preferences.isError || options.isError || !preferences.data || !options.data) {
    return (
      <section role="alert" className="rounded-[20px] border border-[#E7E0D4] bg-white p-6 text-center">
        <p className="text-[14px] text-[#3A4761]">Your job preferences could not be loaded.</p>
        <PillButton
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => {
            void preferences.refetch();
            void options.refetch();
          }}
        >
          Try again
        </PillButton>
      </section>
    );
  }
  if (!preferences.data.profile_completed) {
    return (
      <section className="rounded-[20px] border border-[#E7E0D4] bg-white p-6 text-center">
        <h2 className="text-[16px] font-semibold text-[#0A1931]">Finish your profile first</h2>
        <p className="mx-auto mt-2 max-w-md text-[14px] leading-5 text-[#5F6B80]">
          Job preferences open once your profile is complete. They decide which jobs we recommend
          to you first.
        </p>
        {onOpenProfile && (
          <PillButton type="button" className="mt-4" onClick={onOpenProfile}>
            Complete profile
          </PillButton>
        )}
      </section>
    );
  }
  // Keyed by the saved version: after a save refetches, the form starts
  // again from what the server now holds.
  return (
    <PreferencesEditor
      key={preferences.data.updated_at ?? "new"}
      saved={pick(preferences.data)}
      options={options.data}
    />
  );
}

function PreferencesEditor({
  saved,
  options: opts,
}: {
  saved: JobPreferences;
  options: JobPreferenceOptions;
}) {
  const [save, saving] = useSaveJobPreferencesMutation();
  const [draft, setDraft] = useState<JobPreferences>(saved);
  const [salaryText, setSalaryText] = useState(() => salaryInputFromRupees(saved.preferred_salary));
  const [salaryError, setSalaryError] = useState("");
  const [locationInput, setLocationInput] = useState("");

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of [...opts.work_modes, ...opts.job_types]) {
      map.set(option.value, option.label);
    }
    return map;
  }, [opts]);
  const update = <K extends keyof JobPreferences>(key: K, value: JobPreferences[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const addLocation = () => {
    const place = locationInput.trim().replace(/\s+/g, " ");
    if (!place || draft.preferred_locations.length >= MAX_CHOICES) return;
    if (!draft.preferred_locations.some((item) => item.toLowerCase() === place.toLowerCase())) {
      update("preferred_locations", [...draft.preferred_locations, place]);
    }
    setLocationInput("");
  };

  const submit = async () => {
    if (salaryError) return;
    try {
      await save(draft).unwrap();
      showSuccessFeedback("Job preferences saved. Your recommended jobs are updated.");
    } catch (failure) {
      showErrorFeedback(getApiErrorMessage(failure, "Your preferences could not be saved. Try again."));
    }
  };

  return (
    <form
      className="flex flex-col gap-5 rounded-[20px] border border-[#E7E0D4] bg-white p-4 sm:p-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div>
        <h1 className="text-[20px] font-semibold leading-7 text-[#0A1931]">Job preferences</h1>
        <p className="mt-1 text-[13px] leading-5 text-[#5F6B80]">
          Tell us what you want from your next job. We rank the jobs we recommend to you by these
          answers. Every question is optional; leave one empty if anything suits you.
        </p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <MultiSelectField
          id="pref-roles"
          label="Preferred roles"
          hint="The jobs you want next, even if you have not done them before."
          options={opts.roles}
          values={draft.preferred_roles}
          onChange={(values) => update("preferred_roles", values)}
          searchable
        />
        <MultiSelectField
          id="pref-industries"
          label="Preferred industries"
          options={opts.industries}
          values={draft.preferred_industries}
          onChange={(values) => update("preferred_industries", values)}
          searchable
        />
        <MultiSelectField
          id="pref-work-modes"
          label="Work mode"
          hint="Office, hybrid or remote. Choose all that suit you."
          options={opts.work_modes}
          values={draft.work_modes}
          onChange={(values) => update("work_modes", values as JobPreferences["work_modes"])}
          labelFor={(value) => labels.get(value) ?? value}
        />
        <MultiSelectField
          id="pref-job-types"
          label="Job type"
          options={opts.job_types}
          values={draft.job_types}
          onChange={(values) => update("job_types", values as JobPreferences["job_types"])}
          labelFor={(value) => labels.get(value) ?? value}
        />
      </div>

      <Field
        id="pref-locations"
        label="Preferred work locations"
        hint={`Up to ${MAX_CHOICES} cities.`}
      >
        <div className="relative">
          <input
            id="pref-locations"
            type="text"
            list="pref-location-options"
            value={locationInput}
            maxLength={100}
            disabled={draft.preferred_locations.length >= MAX_CHOICES}
            placeholder="Enter a city"
            className={`${fieldClass} ${fieldBorder(false)} pr-14`}
            onChange={(event) => setLocationInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addLocation();
              }
            }}
          />
          <button
            type="button"
            onClick={addLocation}
            disabled={!locationInput.trim() || draft.preferred_locations.length >= MAX_CHOICES}
            aria-label="Add work location"
            className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-xl text-[#5F4DB2] hover:bg-[#F1EAF7] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={20} />
          </button>
          <CityDatalist id="pref-location-options" query={locationInput} />
        </div>
        {draft.preferred_locations.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Selected work locations">
            {draft.preferred_locations.map((place) => (
              <li
                key={place}
                className="inline-flex items-center gap-1.5 rounded-full border border-[#C9BEEB] bg-[#F1EAF7] py-1.5 pl-3 pr-1.5 text-[13px] font-semibold text-[#4A3E8F]"
              >
                {place}
                <button
                  type="button"
                  aria-label={`Remove ${place}`}
                  onClick={() =>
                    update(
                      "preferred_locations",
                      draft.preferred_locations.filter((item) => item !== place),
                    )
                  }
                  className="grid h-6 w-6 place-items-center rounded-full hover:bg-white/70"
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Field>

      <Field id="pref-relocation" label="Open to relocating?">
        <AppSelect
          id="pref-relocation"
          value={draft.open_to_relocation ? "YES" : "NO"}
          onChange={(value) => update("open_to_relocation", value === "YES")}
          options={[
            { value: "NO", label: "No, only my preferred locations" },
            { value: "YES", label: "Yes, I can move for the right job" },
          ]}
          ariaLabel="Open to relocating"
          menuPlacement="auto"
          portal
          variant="student"
          className={selectClass}
        />
      </Field>

      <div className="grid gap-5 md:grid-cols-[180px_minmax(0,1fr)]">
        <Field id="pref-salary-currency" label="Salary currency">
          <AppSelect
            id="pref-salary-currency"
            value={draft.preferred_salary_currency}
            onChange={(value) => {
              update("preferred_salary_currency", value as JobPreferences["preferred_salary_currency"]);
              setSalaryError("");
            }}
            options={opts.salary_currencies}
            ariaLabel="Salary currency"
            menuPlacement="auto"
            portal
            variant="student"
            className={selectClass}
          />
        </Field>
        <Field
          id="pref-salary"
          label="Preferred annual salary"
          error={salaryError || undefined}
          hint="The yearly amount you would like. Jobs paying at least this rank higher."
        >
          <input
            id="pref-salary"
            type="text"
            inputMode="decimal"
            value={formatSalaryInput(salaryText, draft.preferred_salary_currency)}
            placeholder="Enter annual amount"
            aria-invalid={Boolean(salaryError)}
            aria-describedby={salaryError ? "pref-salary-error" : "pref-salary-hint"}
            className={`${fieldClass} ${fieldBorder(Boolean(salaryError))}`}
            onChange={(event) => {
              const raw = event.target.value;
              setSalaryText(raw);
              if (!raw.trim()) {
                setSalaryError("");
                update("preferred_salary", null);
                return;
              }
              const parsed = parseSalaryLpa(raw, draft.preferred_salary_currency);
              if (parsed.error) setSalaryError(parsed.error);
              else {
                setSalaryError("");
                update("preferred_salary", parsed.value ?? null);
              }
            }}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-[#F0EBDF] pt-4">
        {dirty && (
          <PillButton
            type="button"
            variant="ghost"
            disabled={saving.isLoading}
            onClick={() => {
              setDraft(saved);
              setSalaryText(salaryInputFromRupees(saved.preferred_salary));
              setSalaryError("");
            }}
          >
            Discard changes
          </PillButton>
        )}
        <PillButton type="submit" isLoading={saving.isLoading} disabled={!dirty || Boolean(salaryError)}>
          Save preferences
        </PillButton>
      </div>
    </form>
  );
}

/** `/student/profile/preferences`: the form on its own page, opened from
 *  the profile's "Job preferences" entry (2026-11-23). */
export function JobPreferencesPage() {
  const router = useRouter();
  return (
    <StudentPage>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
        <Link
          href="/student/profile"
          className="flex w-fit items-center gap-2 rounded-xl text-sm font-medium text-[#5F4DB2] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5F4DB2]/30"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Back to profile
        </Link>
        <JobPreferencesForm onOpenProfile={() => router.push("/student/profile#profile-basic")} />
      </div>
    </StudentPage>
  );
}
