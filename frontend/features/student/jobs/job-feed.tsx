"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import { BriefcaseBusiness, Check, Funnel, IndianRupee, MapPin, Search, SlidersHorizontal, Sparkles, X } from "lucide-react";

import { Spinner } from "@/components/common/loading";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  selectJobQualifiedOnly,
  selectJobSearch,
  selectJobWorkMode,
  setJobSearch,
  setJobWorkMode,
  toggleQualifiedOnly,
  useLazyGetStudentJobsQuery,
} from "@/store/student";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";
import { useCursorLoadMore } from "@/lib/pagination/use-cursor-load-more";
import { EmptyState, JobCard, StudentErrorState } from "@/features/student/components";
import { StudentPage } from "@/features/student/shell";

const WORK_MODES = ["ONSITE", "HYBRID", "REMOTE"] as const;
const JOBS_PAGE_SIZE = 10;

export function JobFeed() {
  const dispatch = useAppDispatch();
  const search = useAppSelector(selectJobSearch);
  const debouncedSearch = useDebouncedSearch(search);
  const qualifiedOnly = useAppSelector(selectJobQualifiedOnly);
  const workMode = useAppSelector(selectJobWorkMode);
  const [fetchJobs] = useLazyGetStudentJobsQuery();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [location, setLocation] = useState("");
  const [skill, setSkill] = useState("");
  const [minSalaryMinor, setMinSalaryMinor] = useState<number | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement>(null);

  const jobs = useCursorLoadMore(
    useCallback(
      (cursor: string | undefined) =>
        fetchJobs({
          q: debouncedSearch || undefined,
          location: location || undefined,
          workMode: workMode ?? undefined,
          skill: skill || undefined,
          minSalaryMinor: minSalaryMinor ?? undefined,
          eligibleOnly: qualifiedOnly,
          cursor,
          limit: JOBS_PAGE_SIZE,
        }).unwrap(),
      [fetchJobs, debouncedSearch, location, workMode, skill, minSalaryMinor, qualifiedOnly],
    ),
    [debouncedSearch, location, workMode, skill, minSalaryMinor, qualifiedOnly],
  );
  const loadMoreFromObserver = useEffectEvent(jobs.loadMore);

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (
      !sentinel ||
      !jobs.hasMore ||
      jobs.isLoading ||
      jobs.isLoadingMore ||
      jobs.error
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          loadMoreFromObserver();
        }
      },
      { rootMargin: "240px 0px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [jobs.error, jobs.hasMore, jobs.isLoading, jobs.isLoadingMore]);

  return (
    <StudentPage
      className={jobs.isLoading ? "flex min-h-[calc(100dvh-4rem)] flex-col" : ""}
    >
      <div className="flex flex-1 flex-col gap-5">
        <div className="flex flex-col gap-3.5">
          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-3 rounded-full border border-[#E7E0D4] bg-white px-4 py-3">
              <Search size={16} className="text-[#5F6B80]" />
              <input value={search} onChange={(event) => dispatch(setJobSearch(event.target.value))} placeholder="Role, company or skill" aria-label="Search jobs" className="min-w-0 flex-1 bg-transparent text-[15px] leading-5 text-[#0A1931] outline-none placeholder:text-[#8891a0]" />
            </label>
            <button type="button" onClick={() => setFiltersOpen(true)} aria-label="Open job filters" className="relative grid h-12 w-12 shrink-0 cursor-pointer place-items-center rounded-full border border-[#E7E0D4] bg-white text-[#0A1931] transition hover:border-[#C9BEEB] hover:bg-[#F7F4EC]">
              <SlidersHorizontal size={19} />
              {(qualifiedOnly || workMode || location || skill || minSalaryMinor) && <span className="absolute right-0.5 top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#5F4DB2]" />}
            </button>
          </div>
          <button type="button" onClick={() => dispatch(toggleQualifiedOnly())} className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-[#E7E0D4] bg-white px-4 py-3 text-left text-[14px] font-semibold text-[#0A1931] sm:max-w-xs">
            <span className={`grid h-5 w-5 place-items-center rounded-full border ${qualifiedOnly ? "border-[#5F4DB2] bg-[#5F4DB2] text-white" : "border-[#C6BFAF]"}`}>{qualifiedOnly && <Check size={12} />}</span>
            Only jobs I can apply to
          </button>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="text-[11px] font-bold uppercase leading-4 tracking-[0.12em] text-[#5F6B80]">
            {jobs.isLoading ? "Finding jobs" : `${jobs.items.length} jobs`}
          </span>
        </div>

        {jobs.isLoading ? (
          <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 text-center">
            <Spinner size={32} tone="primary" />
            <p className="text-[15px] font-semibold text-[#0A1931]">
              Finding jobs for you
            </p>
            <p className="text-[13px] text-[#5F6B80]">
              Checking the latest roles that match your preferences.
            </p>
          </div>
        ) : jobs.error && !jobs.items.length ? (
          <StudentErrorState
            icon={<Search size={22} />}
            title="Jobs unavailable"
            error={jobs.error}
            fallback="Could not load jobs."
          />
        ) : jobs.items.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {jobs.items.map((job) => (
                <JobCard key={job.id} job={job} />
              ))}
            </div>

            {jobs.isLoadingMore ? (
              <div className="flex justify-center py-6">
                <Spinner size={28} tone="primary" label="Loading more jobs" />
              </div>
            ) : null}

            {jobs.error && jobs.hasMore ? (
              <div className="flex flex-col items-center gap-2 pt-1">
                <span className="text-[13px] text-[#5F6B80]">
                  Could not load more jobs.
                </span>
                <button
                  type="button"
                  onClick={jobs.loadMore}
                  className="rounded-full border border-[#E7E0D4] bg-white px-5 py-2.5 text-[13px] font-semibold text-[#0A1931] transition-colors hover:bg-[#F7F3EC] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Try again
                </button>
              </div>
            ) : null}

            <div
              ref={loadMoreSentinelRef}
              aria-hidden="true"
              className="h-px w-full"
            />
          </>
        ) : (
          <EmptyState
            icon={<Search size={22} />}
            title="No jobs match"
            message="Try clearing a filter or changing your search."
          />
        )}
      </div>
      {filtersOpen && (
        <JobFiltersDrawer
          qualifiedOnly={qualifiedOnly}
          workMode={workMode}
          location={location}
          skill={skill}
          minSalaryMinor={minSalaryMinor}
          onClose={() => setFiltersOpen(false)}
          onApply={(next) => {
            if (next.qualifiedOnly !== qualifiedOnly) dispatch(toggleQualifiedOnly());
            if (next.workMode !== workMode) dispatch(setJobWorkMode(next.workMode));
            setLocation(next.location);
            setSkill(next.skill);
            setMinSalaryMinor(next.minSalaryMinor);
            setFiltersOpen(false);
          }}
        />
      )}
    </StudentPage>
  );
}

interface JobFilterValues {
  qualifiedOnly: boolean;
  workMode: string | null;
  location: string;
  skill: string;
  minSalaryMinor: number | null;
}

const SALARIES = [
  { label: "₹10k", value: 1_000_000 },
  { label: "₹15k", value: 1_500_000 },
  { label: "₹20k", value: 2_000_000 },
  { label: "₹25k+", value: 2_500_000 },
];

function JobFiltersDrawer({ onClose, onApply, ...initial }: JobFilterValues & {
  onClose: () => void;
  onApply: (filters: JobFilterValues) => void;
}) {
  const [draft, setDraft] = useState<JobFilterValues>(initial);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const update = <K extends keyof JobFilterValues>(key: K, value: JobFilterValues[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const reset = () => setDraft({ qualifiedOnly: false, workMode: null, location: "", skill: "", minSalaryMinor: null });

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[#0A1931]/35" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside role="dialog" aria-modal="true" aria-label="Job filters" className="flex h-full w-full max-w-[460px] flex-col bg-[#FFFCF7] font-sans text-[13px] leading-5 shadow-[-16px_0_48px_rgba(10,25,49,0.18)] lg:text-[14px]">
        <header className="flex shrink-0 items-center justify-between border-b border-[#E7E0D4] px-5 py-4 sm:px-6">
          <div className="flex items-center gap-2.5"><span className="grid h-9 w-9 place-items-center rounded-xl bg-[#F1EAF7] text-[#5F4DB2]"><Funnel size={17} /></span><h2 className="text-[18px] font-bold text-[#0A1931]">Filters</h2></div>
          <div className="flex items-center gap-2"><button type="button" onClick={reset} className="cursor-pointer px-2 py-2 text-[12px] font-semibold text-[#5F6B80] hover:text-[#0A1931] lg:text-[13px]">Reset</button><button type="button" onClick={onClose} aria-label="Close filters" className="grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-[#E7E0D4] bg-white"><X size={16} /></button></div>
        </header>

        <div className="bp-scrollbar flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">
          <FilterGroup icon={<Funnel size={16} />} label="Show me">
            <div className="grid grid-cols-2 gap-2">
              <Choice active={!draft.qualifiedOnly} onClick={() => update("qualifiedOnly", false)}>All jobs</Choice>
              <Choice active={draft.qualifiedOnly} onClick={() => update("qualifiedOnly", true)}>Only jobs I can apply to</Choice>
            </div>
          </FilterGroup>

          <FilterGroup icon={<MapPin size={16} />} label="Location">
            <input value={draft.location} maxLength={100} onChange={(event) => update("location", event.target.value)} placeholder="City or area" className="w-full rounded-xl border border-[#E7E0D4] bg-white px-3.5 py-3 text-[13px] text-[#0A1931] outline-none placeholder:text-[#8891A0] focus:border-[#5F4DB2] lg:text-[14px]" />
          </FilterGroup>

          <FilterGroup icon={<BriefcaseBusiness size={16} />} label="Work mode">
            <div className="flex flex-wrap gap-2">{WORK_MODES.map((mode) => <Choice key={mode} active={draft.workMode === mode} onClick={() => update("workMode", draft.workMode === mode ? null : mode)}>{mode[0] + mode.slice(1).toLowerCase()}</Choice>)}</div>
          </FilterGroup>

          <FilterGroup icon={<IndianRupee size={16} />} label="Minimum salary">
            <div className="flex flex-wrap gap-2">{SALARIES.map((salary) => <Choice key={salary.value} active={draft.minSalaryMinor === salary.value} onClick={() => update("minSalaryMinor", draft.minSalaryMinor === salary.value ? null : salary.value)}>{salary.label}</Choice>)}</div>
            <p className="text-[10px] text-[#7B8495] lg:text-[11px]">Salary amounts are sent to the jobs API in paise.</p>
          </FilterGroup>

          <FilterGroup icon={<Sparkles size={16} />} label="Skill">
            <input value={draft.skill} maxLength={80} onChange={(event) => update("skill", event.target.value)} placeholder="e.g. React, Nursing, Tally" className="w-full rounded-xl border border-[#E7E0D4] bg-white px-3.5 py-3 text-[13px] text-[#0A1931] outline-none placeholder:text-[#8891A0] focus:border-[#5F4DB2] lg:text-[14px]" />
          </FilterGroup>
        </div>

        <footer className="shrink-0 border-t border-[#E7E0D4] bg-white p-4 sm:px-6">
          <button type="button" onClick={() => onApply(draft)} className="w-full cursor-pointer rounded-full bg-[#5F4DB2] px-5 py-3.5 text-[13px] font-bold text-white shadow-[0_8px_20px_rgba(95,77,178,0.22)] transition hover:bg-[#4A3E8F] lg:text-[14px]">Show jobs</button>
        </footer>
      </aside>
    </div>
  );
}

function FilterGroup({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return <section className="flex flex-col gap-2.5"><div className="flex items-center gap-2 text-[#A77B0D]">{icon}<h3 className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#5F6B80] lg:text-[12px]">{label}</h3></div>{children}</section>;
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`cursor-pointer rounded-xl border px-3.5 py-2.5 text-[12px] font-semibold transition lg:text-[13px] ${active ? "border-[#C9BEEB] bg-[#F1EAF7] text-[#4A3E8F]" : "border-transparent bg-[#F7EFD6] text-[#3A4761] hover:border-[#E0D5B5]"}`}>
      {children}
    </button>
  );
}
