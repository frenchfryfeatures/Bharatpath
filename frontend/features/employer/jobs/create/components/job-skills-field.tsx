"use client";

import {
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ErrorState } from "@/components/ui";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";
import { useGetEmployerCandidateSkillSuggestionsQuery } from "@/store/employer/candidates";

import type { JobValidationErrors } from "../schemas/job.schema";

const MAX_SKILLS = 50;
const MAX_SKILL_LENGTH = 80;

interface JobSkillsFieldProps {
  value: string[];
  error?: JobValidationErrors["skills"];
  disabled?: boolean;
  onChange: (skills: string[]) => void;
}

export function JobSkillsField({
  value,
  error,
  disabled = false,
  onChange,
}: JobSkillsFieldProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const typedQuery = query.trim();
  const debouncedQuery = useDebouncedSearch(query);
  const {
    currentData,
    error: suggestionsError,
    isFetching,
    refetch,
  } = useGetEmployerCandidateSkillSuggestionsQuery(
    { q: debouncedQuery, limit: 10 },
    {
      skip: disabled || debouncedQuery.length === 0,
      refetchOnMountOrArgChange: true,
    },
  );

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const suggestions = useMemo(() => {
    const selected = new Set(value.map((skill) => skill.toLocaleLowerCase()));
    const choices = currentData?.items ?? [];
    const visible =
      typedQuery && typedQuery !== debouncedQuery
        ? choices.filter((choice) =>
            choice.label
              .toLocaleLowerCase()
              .includes(typedQuery.toLocaleLowerCase()),
          )
        : choices;

    return visible.filter(
      (choice) => !selected.has(choice.label.toLocaleLowerCase()),
    );
  }, [currentData?.items, debouncedQuery, typedQuery, value]);
  const hasExactMatch = [...value, ...suggestions.map((item) => item.label)]
    .some(
      (skill) =>
        skill.toLocaleLowerCase() === typedQuery.toLocaleLowerCase(),
    );
  const canAddTyped =
    typedQuery.length > 0 &&
    typedQuery.length <= MAX_SKILL_LENGTH &&
    value.length < MAX_SKILLS &&
    !hasExactMatch;
  const isSearching =
    typedQuery.length > 0 &&
    (typedQuery !== debouncedQuery || isFetching);

  function addSkill(skill: string) {
    if (
      disabled ||
      value.length >= MAX_SKILLS ||
      value.some(
        (item) => item.toLocaleLowerCase() === skill.toLocaleLowerCase(),
      )
    ) {
      return;
    }

    onChange([...value, skill]);
    setQuery("");
    inputRef.current?.focus();
  }

  function removeSkill(skill: string) {
    if (disabled) {
      return;
    }
    onChange(value.filter((item) => item !== skill));
  }

  return (
    <div>
      <span className="mb-1.5 block text-[12px] font-semibold leading-4 text-[#687386]">
        Required skills <span className="text-[#b42318]">*</span>
      </span>

      {value.length > 0 ? (
        <div className="mb-2 flex flex-wrap gap-2">
          {value.map((skill) => (
            <span
              key={skill}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#edf2fa] px-3 py-2 text-xs font-semibold text-[#28578f] ring-1 ring-[#2f5da8]/20"
            >
              {skill}
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => removeSkill(skill)}
                  aria-label={`Remove ${skill}`}
                  className="cursor-pointer rounded-full text-[#687386] hover:text-[#b42318]"
                >
                  <X aria-hidden="true" size={13} />
                </button>
              ) : null}
            </span>
          ))}
        </div>
      ) : null}

      <div ref={containerRef} className="relative">
        <Search
          aria-hidden="true"
          size={15}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#777f90]"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open && typedQuery.length > 0}
          aria-controls="job-skill-suggestions"
          value={query}
          maxLength={MAX_SKILL_LENGTH}
          disabled={disabled || value.length >= MAX_SKILLS}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          placeholder={
            disabled
              ? "Required skills"
              : value.length >= MAX_SKILLS
              ? "Maximum 50 skills selected"
              : "Search required skills"
          }
          className="h-10 w-full rounded-[9px] border border-[#e1e5ea] bg-white pl-9 pr-3 text-[12px] text-[#182132] outline-none placeholder:text-[#8a919d] focus:border-[#9bb4d4] focus:ring-2 focus:ring-[#315f9b]/10 disabled:cursor-not-allowed disabled:bg-[#f5f6f8]"
        />

        {!disabled && open && typedQuery ? (
          <div
            id="job-skill-suggestions"
            role="listbox"
            className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-[10px] border border-[#e1e5ea] bg-white p-1 shadow-[0_8px_24px_rgba(19,26,38,0.10)]"
          >
            {isSearching ? (
              <p
                role="status"
                className="flex items-center gap-2 px-3 py-2 text-[12px] text-[#687386]"
              >
                <Loader2
                  aria-hidden="true"
                  size={14}
                  className="animate-spin"
                />
                Searching skills...
              </p>
            ) : (
              <>
                {suggestions.map((skill) => (
                  <button
                    key={skill.key}
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => addSkill(skill.label)}
                    className="flex w-full cursor-pointer items-center rounded-[7px] px-3 py-2 text-left text-[12px] font-medium text-[#4f5969] hover:bg-[#f7f8fa]"
                  >
                    {skill.label}
                  </button>
                ))}

                {canAddTyped ? (
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => addSkill(typedQuery)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-[7px] px-3 py-2 text-left text-[12px] font-semibold text-[#315f9b] hover:bg-[#f1f5fb]"
                  >
                    <Plus aria-hidden="true" size={14} />
                    Add &ldquo;{typedQuery}&rdquo;
                  </button>
                ) : null}

                {suggestions.length === 0 && !canAddTyped ? (
                  <p className="px-3 py-2 text-[12px] text-[#98a1b0]">
                    No skills found
                  </p>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>

      {!disabled && suggestionsError && debouncedQuery ? (
        <ErrorState
          error={suggestionsError}
          fallback="Skill suggestions could not be loaded."
          onRetry={() => void refetch()}
          className="mt-2"
        />
      ) : null}

      {error ? (
        <p className="mt-1.5 text-xs font-medium text-[#b42318]">{error}</p>
      ) : null}
    </div>
  );
}
