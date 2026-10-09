"use client";

import { ChevronRight, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";
import {
  useGetEmployerCandidateFiltersQuery,
  useGetEmployerCandidateLocationSuggestionsQuery,
  useGetEmployerCandidateSkillSuggestionsQuery,
} from "@/store/employer/candidates";
import { Skeleton } from "@/components/common/loading";
import { Dropdown } from "@/components/ui";
import {
  EmployerErrorState,
  isSubscriptionRequired,
} from "@/features/employer/components/employer-error-state";

import type { CandidateBand, CandidateFiltersState } from "./types";

function uniqueChoices<T extends { key: string; label: string }>(
  choices: T[],
): T[] {
  const seen = new Set<string>();

  return choices.filter((choice) => {
    const key = choice.label.toLocaleLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * While the typed text has not yet settled into a request, narrow what is
 * already loaded so the list still responds to each keystroke. Once it has
 * settled, the server's matches (aliases included) are shown as returned.
 */
function narrowWhileTyping<T extends { label: string }>(
  choices: T[],
  typed: string,
  settled: string,
): T[] {
  if (!typed || typed === settled) {
    return choices;
  }

  const needle = typed.toLocaleLowerCase();
  return choices.filter((choice) =>
    choice.label.toLocaleLowerCase().includes(needle),
  );
}

interface CandidateFiltersProps {
  mobileOpen?: boolean;
  onClose?: () => void;
  filters: CandidateFiltersState;
  /** What is in the search box now; the query only hears it once settled. */
  search: string;
  onSearch: (value: string) => void;
  onStateChange: (value: string) => void;
  onToggleBand: (value: CandidateBand) => void;
  onToggleFilter: (
    key: "skills" | "locations" | "experiences" | "addons",
    value: string,
  ) => void;
}

export function CandidateFilters({
  mobileOpen = false,
  onClose,
  filters,
  search,
  onSearch,
  onStateChange,
  onToggleBand,
  onToggleFilter,
}: CandidateFiltersProps) {
  const [skillQuery, setSkillQuery] = useState("");
  const [locationQuery, setLocationQuery] = useState("");
  // What the user has typed, used for instant local narrowing and the
  // "add this" option; the debounced text is what reaches the API.
  const typedSkill = skillQuery.trim();
  const typedLocation = locationQuery.trim();
  const debouncedSkillQuery = useDebouncedSearch(skillQuery);
  const debouncedLocationQuery = useDebouncedSearch(locationQuery);
  const {
    data: panel,
    error: panelError,
    isLoading: panelLoading,
    isFetching: panelFetching,
    refetch: refetchPanel,
  } = useGetEmployerCandidateFiltersQuery();
  const {
    data: skillSuggestions,
    isFetching: skillSuggestionsFetching,
  } =
    useGetEmployerCandidateSkillSuggestionsQuery(
      { q: debouncedSkillQuery, limit: 10 },
      { skip: debouncedSkillQuery.length === 0 },
    );
  const {
    data: locationSuggestions,
    isFetching: locationSuggestionsFetching,
  } =
    useGetEmployerCandidateLocationSuggestionsQuery(
      {
        q: debouncedLocationQuery,
        state: filters.state || undefined,
        limit: 10,
      },
      { skip: debouncedLocationQuery.length === 0 },
    );

  const skills = useMemo(() => {
    const loaded = debouncedSkillQuery
      ? skillSuggestions?.items ?? []
      : panel?.skills ?? [];
    return uniqueChoices([
      ...filters.skills.map((label) => ({ key: label, label })),
      ...narrowWhileTyping(loaded, typedSkill, debouncedSkillQuery),
    ]);
  }, [
    debouncedSkillQuery,
    filters.skills,
    panel?.skills,
    skillSuggestions?.items,
    typedSkill,
  ]);
  const cities = useMemo(() => {
    const loaded = debouncedLocationQuery
      ? locationSuggestions?.items ?? []
      : (panel?.cities ?? []).filter(
          (city) => !filters.state || city.state_code === filters.state,
        );
    return uniqueChoices([
      ...filters.locations.map((label) => ({
        key: label,
        label,
        state_code: filters.state,
      })),
      ...narrowWhileTyping(loaded, typedLocation, debouncedLocationQuery),
    ]);
  }, [
    debouncedLocationQuery,
    filters.locations,
    filters.state,
    locationSuggestions?.items,
    panel?.cities,
    typedLocation,
  ]);
  const canAddSkill =
    typedSkill.length > 0 &&
    typedSkill.length <= (panel?.limits.max_skill_length ?? 80) &&
    !skills.some(
      (skill) =>
        skill.label.toLocaleLowerCase() ===
          typedSkill.toLocaleLowerCase() ||
        skill.key.toLocaleLowerCase() ===
          typedSkill.toLocaleLowerCase(),
    );
  const canAddCity =
    typedLocation.length > 0 &&
    typedLocation.length <= (panel?.limits.max_city_length ?? 100) &&
    !cities.some(
      (city) =>
        city.label.toLocaleLowerCase() ===
          typedLocation.toLocaleLowerCase() ||
        city.key.toLocaleLowerCase() ===
          typedLocation.toLocaleLowerCase(),
    );
  const maxSkillsReached =
    filters.skills.length >= (panel?.limits.max_skills ?? 5);
  const maxCitiesReached =
    filters.locations.length >= (panel?.limits.max_cities ?? 5);
  const stateOptions = useMemo(
    () => [
      { value: "", label: "All states" },
      ...(panel?.states ?? []).map((state) => ({
        value: state.code,
        label: state.name,
      })),
    ],
    [panel?.states],
  );

  return (
    <aside
      id="candidate-filters"
      data-scroll-lock-root
      aria-label="Candidate filters"
      className={`${mobileOpen ? "flex" : "hidden"} fixed inset-y-0 right-0 z-[60] w-[min(320px,90vw)] flex-col border-l border-[#e7eaef] bg-white shadow-2xl lg:static lg:z-auto lg:flex lg:h-full lg:w-[268px] lg:shrink-0 lg:shadow-none`}
    >
      {/* =================================================
          FILTER CONTENT
          ================================================= */}
      <div className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto px-[18px] pb-[64px] pt-4">
        {/* =================================================
            HEADER
            ================================================= */}
        <div className="flex items-center justify-between">
          <span className="text-[14px] font-semibold leading-[18px] text-[#182132]">
            Filters
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg text-[#5d6673] hover:bg-[#f3f4f7] lg:hidden"
          >
            <X size={18} />
          </button>
          {panelFetching ? (
            <div role="status" aria-busy="true">
              <span className="sr-only">
                {panelLoading
                  ? "Loading filter options"
                  : "Updating filter options"}
              </span>
              <Skeleton width={64} height={10} radius={5} />
            </div>
          ) : null}
        </div>

        {panelError && !isSubscriptionRequired(panelError) ? (
          <EmployerErrorState
            error={panelError}
            fallback="Filter options could not be loaded."
            onRetry={() => void refetchPanel()}
          />
        ) : null}

        {/* =================================================
            SEARCH
            ================================================= */}
        <div className="flex h-[40px] items-center gap-[10px] rounded-[10px] border border-[#e7eaef] bg-[#f8f9fb] px-[10px] py-[12px]">
          <Search
            size={14}
            strokeWidth={2}
            className="shrink-0 text-[#687386]"
          />

          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search skills"
            aria-label="Search candidates"
            className="min-w-0 flex-1 border-0 bg-transparent text-[13px] font-normal leading-[18px] text-[#182132] outline-none placeholder:text-[#687386]"
          />
        </div>

        {/* =================================================
            SCORE BAND
            ================================================= */}
        <FilterSection title="SCORE BAND">
          {panelLoading ? (
            <FilterRowsSkeleton label="Loading score bands" count={4} />
          ) : (
            <div className="flex flex-col gap-[2px]">
              {(panel?.bands ?? []).map((item) => (
                <CheckRow
                  key={item.value}
                  label={item.label}
                  checked={filters.bands.includes(item.value)}
                  onClick={() => onToggleBand(item.value)}
                />
              ))}
            </div>
          )}
        </FilterSection>

        <Divider />

        {/* =================================================
            SKILLS
            ================================================= */}
        <FilterSection title="SKILLS">
          <FilterLookup
            value={skillQuery}
            placeholder="Find or add a skill"
            maxLength={panel?.limits.max_skill_length ?? 80}
            onChange={setSkillQuery}
          />
          <div className="flex flex-wrap gap-[6px]">
            {skills.map((skill) => {
              const active =
                filters.skills.includes(skill.label);
              const disabled = !active && maxSkillsReached;

              return (
                <button
                  key={skill.key}
                  type="button"
                  aria-pressed={active}
                  disabled={disabled}
                  onClick={() =>
                    onToggleFilter("skills", skill.label)
                  }
                  className={[
                    "inline-flex cursor-pointer items-center gap-[5px]",
                    "rounded-full px-[10px] py-[6px]",
                    "text-[11px] font-semibold leading-[14px]",
                    "transition-colors",
                    active
                      ? "bg-[#e9e5ff] text-[#51449a]"
                      : "bg-[#f2f4f7] text-[#687386]",
                    disabled ? "cursor-not-allowed opacity-50" : "",
                  ].join(" ")}
                >
                  {skill.label}
                </button>
              );
            })}
          </div>
          {panelLoading || skillSuggestionsFetching ? (
            <FilterPillsSkeleton
              label={
                panelLoading
                  ? "Loading skill filters"
                  : "Loading skill suggestions"
              }
              count={panelLoading ? 7 : 4}
            />
          ) : null}
          {canAddSkill ? (
            <AddTypedFilter
              label={typedSkill}
              disabled={maxSkillsReached}
              onClick={() => {
                onToggleFilter("skills", typedSkill);
                setSkillQuery("");
              }}
            />
          ) : null}
        </FilterSection>

        <Divider />

        {/* =================================================
            LOCATION
            ================================================= */}
        <FilterSection title="LOCATION">
          {panelLoading ? (
            <FilterSelectSkeleton />
          ) : (
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-[#687386]">
                State
              </span>
              <Dropdown
                value={filters.state}
                options={stateOptions}
                onChange={onStateChange}
                ariaLabel="State"
                width="w-full"
                buttonClassName="h-9 rounded-lg border-[#e2e5eb] px-2 text-[12px] font-normal text-[#273142] focus:border-[#315c9f] focus:ring-[#315c9f]/10"
                menuClassName="max-h-[240px]"
              />
            </div>
          )}
          <FilterLookup
            value={locationQuery}
            placeholder="Find or add a city"
            maxLength={panel?.limits.max_city_length ?? 100}
            onChange={setLocationQuery}
          />
          <div className="flex flex-col gap-[2px]">
            {cities.map((location) => (
              <CheckRow
                key={`${location.key}-${location.state_code}`}
                label={
                  location.state_code
                    ? `${location.label} · ${location.state_code}`
                    : location.label
                }
                checked={filters.locations.includes(
                  location.label,
                )}
                disabled={
                  !filters.locations.includes(location.label) &&
                  maxCitiesReached
                }
                onClick={() =>
                  onToggleFilter("locations", location.label)
                }
              />
            ))}
          </div>
          {panelLoading || locationSuggestionsFetching ? (
            <FilterRowsSkeleton
              label={
                panelLoading
                  ? "Loading location filters"
                  : "Loading city suggestions"
              }
              count={panelLoading ? 4 : 3}
            />
          ) : null}
          {canAddCity ? (
            <AddTypedFilter
              label={typedLocation}
              disabled={maxCitiesReached}
              onClick={() => {
                onToggleFilter("locations", typedLocation);
                setLocationQuery("");
              }}
            />
          ) : null}
        </FilterSection>

        <Divider />

        {/* =================================================
            EXPERIENCE
            ================================================= */}
        <FilterSection title="MINIMUM EXPERIENCE">
          {panelLoading ? (
            <FilterRowsSkeleton
              label="Loading experience filters"
              count={4}
            />
          ) : (
            <div className="flex flex-col gap-[2px]">
              {(panel?.experience ?? []).map((item) => (
                <CheckRow
                  key={item.min_years}
                  label={item.label}
                  checked={filters.experiences.includes(
                    String(item.min_years),
                  )}
                  onClick={() =>
                    onToggleFilter("experiences", String(item.min_years))
                  }
                />
              ))}
            </div>
          )}
        </FilterSection>

      </div>
    </aside>
  );
}

/* =========================================================
   FILTER SECTION
   ========================================================= */

function FilterSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);

  return (
    <section className="flex flex-col gap-[10px]">
      {/* Section heading */}
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full cursor-pointer items-center gap-[6px] text-left"
      >
        <ChevronRight
          size={10}
          strokeWidth={2}
          className={`shrink-0 text-[#687386] transition-transform duration-150 ${
            open ? "rotate-90" : ""
          }`}
        />

        <span className="text-[11px] font-bold leading-[14px] tracking-[0.06em] text-[#687386]">
          {title}
        </span>
      </button>

      {/* Section content */}
      {open && children}
    </section>
  );
}

/* =========================================================
   DIVIDER
   ========================================================= */

function Divider() {
  return (
    <div className="h-px w-full shrink-0 bg-[#eef0f3]" />
  );
}

function FilterRowsSkeleton({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  const widths = [72, 104, 86, 112];

  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col gap-[9px] py-1"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="flex items-center gap-2">
          <Skeleton circle width={15} height={15} />
          <Skeleton
            width={widths[index % widths.length]}
            height={10}
            radius={5}
          />
        </div>
      ))}
    </div>
  );
}

function FilterPillsSkeleton({
  label,
  count,
}: {
  label: string;
  count: number;
}) {
  const widths = [112, 90, 126, 104, 118, 82, 96];

  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-wrap gap-[6px]"
    >
      <span className="sr-only">{label}</span>
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton
          key={index}
          width={widths[index % widths.length]}
          height={26}
          radius={999}
        />
      ))}
    </div>
  );
}

function FilterSelectSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-1">
      <span className="sr-only">Loading states</span>
      <Skeleton width={34} height={9} radius={5} />
      <Skeleton width="100%" height={36} radius={8} />
    </div>
  );
}

function FilterLookup({
  value,
  placeholder,
  maxLength,
  onChange,
}: {
  value: string;
  placeholder: string;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex h-9 items-center gap-2 rounded-lg border border-[#e2e5eb] bg-white px-2 focus-within:border-[#315c9f]">
      <Search className="h-3.5 w-3.5 shrink-0 text-[#687386]" />
      <input
        type="text"
        value={value}
        maxLength={maxLength}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[12px] text-[#273142] outline-none placeholder:text-[#8a92a0]"
      />
    </label>
  );
}

function AddTypedFilter({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-dashed border-[#cbd2dc] px-2 py-1.5 text-left text-[11px] font-semibold text-[#315c9f] hover:bg-[#f7f9fc] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus className="h-3.5 w-3.5 shrink-0" />
      Add &quot;{label}&quot;
    </button>
  );
}

/* =========================================================
   RADIO / CHECK ROW
   ========================================================= */

function CheckRow({
  label,
  checked,
  disabled = false,
  onClick,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={checked}
      disabled={disabled}
      onClick={onClick}
      className="flex w-full cursor-pointer items-center gap-[8px] rounded-[8px] p-[4px] text-left transition-colors hover:bg-[#f8f9fb] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {/* Radio */}
      <span
        className={[
          "grid h-[16px] w-[16px] shrink-0 place-items-center rounded-full border",
          checked
            ? "border-[#5b4fcf] bg-[#5b4fcf]"
            : "border-[#dfe3e9] bg-white",
        ].join(" ")}
      >
        {checked && (
          <span className="h-[6px] w-[6px] rounded-full bg-white" />
        )}
      </span>

      {/* Label */}
      <span className="text-[13px] font-medium leading-[17px] text-[#273142]">
        {label}
      </span>
    </button>
  );
}
