"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { CursorPagination } from "@/components/ui";
import { EmployerErrorState } from "@/features/employer/components/employer-error-state";
import { usePageHeader } from "@/components/layout/header-context";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  goToNextCandidatePage,
  goToPreviousCandidatePage,
  selectEmployerCandidateCursor,
  selectEmployerCandidateFilters,
  selectEmployerCandidatePage,
  selectEmployerCandidatePageSize,
  setCandidatePageSize,
  setCandidateSearch,
  setCandidateState,
  toggleCandidateBand,
  toggleCandidateFilter,
  useSearchEmployerCandidatesQuery,
  useLazyRevealEmployerCandidateQuery,
  type RevealedCandidateResponse,
} from "@/store/employer/candidates";

import { CandidateCard } from "./candidate-card";
import { CandidateDetailsDialog } from "./candidate-details-dialog";
import { CandidateFilters } from "./candidate-filters";
import { CandidateListSkeleton } from "./candidate-list-skeleton";
import type { Candidate } from "./types";

const EMPTY_CANDIDATES: Candidate[] = [];
const CANDIDATE_PAGE_SIZES = [10, 25, 50, 100] as const;

export function CandidatesPage() {
  usePageHeader(
    "Candidates",
    "Search candidates by score, skills and location"
  );

  const dispatch = useAppDispatch();
  const filters = useAppSelector(selectEmployerCandidateFilters);
  const page = useAppSelector(selectEmployerCandidatePage);
  const cursor = useAppSelector(selectEmployerCandidateCursor);
  const storedPageSize = useAppSelector(selectEmployerCandidatePageSize);
  const pageSize = CANDIDATE_PAGE_SIZES.includes(
    storedPageSize as (typeof CANDIDATE_PAGE_SIZES)[number],
  )
    ? storedPageSize
    : 10;
  // The box is local; the store (and with it the query and its cursor
  // reset) only hears the text once typing has settled.
  const [searchInput, setSearchInput] = useState(filters.search);
  const debouncedSearch = useDebouncedSearch(searchInput);
  const committedSearch = filters.search;

  useEffect(() => {
    if (debouncedSearch !== committedSearch) {
      dispatch(setCandidateSearch(debouncedSearch));
    }
  }, [committedSearch, debouncedSearch, dispatch]);

  const query = useMemo(() => ({
    q: committedSearch.trim() || undefined,
    band: filters.bands.length ? filters.bands : undefined,
    skill: filters.skills.length ? filters.skills : undefined,
    state: filters.state || undefined,
    city: filters.locations.length ? filters.locations : undefined,
    min_experience_years: filters.experiences.length
      ? Number(filters.experiences[0])
      : undefined,
    cursor: cursor || undefined,
    limit: pageSize,
  }), [
    cursor,
    committedSearch,
    filters.bands,
    filters.experiences,
    filters.locations,
    filters.skills,
    filters.state,
    pageSize,
  ]);

  const { data, error, isLoading, isFetching } = useSearchEmployerCandidatesQuery(query);
  const candidates = data?.items ?? EMPTY_CANDIDATES;
  const nextCursor = data?.nextCursor ?? null;
  const isCandidateListLoading = isLoading || isFetching;
  const [revealCandidate, revealState] = useLazyRevealEmployerCandidateQuery();
  const [selectedCandidateId, setSelectedCandidateId] =
    useState<string | null>(null);
  const [revealed, setRevealed] = useState<RevealedCandidateResponse | null>(null);
  const [openedCandidates, setOpenedCandidates] = useState<Record<string, RevealedCandidateResponse>>({});
  const profileRequest = useRef(0);

  async function openCandidateProfile(candidateId: string) {
    const request = ++profileRequest.current;
    setSelectedCandidateId(candidateId);
    setRevealed(null);
    revealState.reset();

    const result = await revealCandidate(candidateId);
    if (result.data) {
      if (request === profileRequest.current) setRevealed(result.data);
      setOpenedCandidates((previous) => ({ ...previous, [candidateId]: result.data! }));
    }
  }

  function closeCandidateProfile() {
    profileRequest.current += 1;
    setSelectedCandidateId(null);
    setRevealed(null);
    revealState.reset();
  }

  /* =====================================================
     PAGE
     ===================================================== */

  return (
    <div className="flex h-full min-h-0 w-full overflow-hidden bg-[#f7f8fa] text-[#202a3b]">

      {/* =================================================
          MAIN CANDIDATES SECTION
          ================================================= */}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">

        {/* -------------------------------------------------
            TOOLBAR
            ------------------------------------------------- */}

        <div className="flex h-[54px] shrink-0 items-center justify-between px-4">

          <div
            role="status"
            aria-live="polite"
            className="text-[12px] text-[#647083]"
          >
            {isLoading
              ? "Loading candidates..."
              : isFetching
                ? "Updating candidates..."
                : `Showing ${candidates.length} candidates`}
          </div>

          <span className="text-[11px] text-[#697385]">
            Ordered by match band
          </span>
        </div>

        {/* -------------------------------------------------
            CANDIDATE LIST

            THIS IS THE ONLY SCROLLABLE AREA
            ------------------------------------------------- */}

        <div
          aria-busy={isCandidateListLoading}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pt-3 pb-4"
        >

          {/* min-h-full, not h-full: a fixed-height column would let the cards
              overflow it and scroll past the bottom padding. */}
          <div className="flex min-h-full flex-col gap-3">

            {isCandidateListLoading && (
              <CandidateListSkeleton count={Math.min(pageSize, 10)} />
            )}

            {!isCandidateListLoading && candidates.map((candidate) => (
              <CandidateCard
                key={candidate.candidateId}
                candidate={{ ...candidate, fullName: openedCandidates[candidate.candidateId]?.full_name ?? candidate.fullName }}
                onReveal={() =>
                  void openCandidateProfile(candidate.candidateId)
                }
              />
            ))}

            {!isCandidateListLoading && error && (
              <EmployerErrorState
                error={error}
                fallback="Candidates could not be loaded. Check your employer subscription and API connection."
              />
            )}

            {!isCandidateListLoading && !error && candidates.length === 0 && (
              <div className="rounded-[12px] border border-dashed border-[#dfe3e9] bg-white p-10 text-center text-[12px] text-[#737d8c]">
                No candidates match the selected filters.
              </div>
            )}

          </div>
        </div>

        {/* -------------------------------------------------
            PAGINATION

            FIXED — NEVER SCROLLS
            ------------------------------------------------- */}

        <CursorPagination
          currentPage={page}
          itemCount={candidates.length}
          pageSize={pageSize}
          hasNextPage={Boolean(nextCursor)}
          isLoading={isFetching}
          onPreviousPage={() => dispatch(goToPreviousCandidatePage())}
          onNextPage={() => {
            if (nextCursor) {
              dispatch(goToNextCandidatePage(nextCursor));
            }
          }}
          onPageSizeChange={(size) => dispatch(setCandidatePageSize(size))}
          itemLabel={candidates.length === 1 ? "candidate" : "candidates"}
          className="h-[58px] shrink-0 px-4"
        />
      </main>

      {/* =================================================
          FILTER SIDEBAR
          ================================================= */}

      <CandidateFilters
        filters={filters}
        search={searchInput}
        onSearch={setSearchInput}
        onStateChange={(value) => dispatch(setCandidateState(value))}
        onToggleBand={(value) => dispatch(toggleCandidateBand(value))}
        onToggleFilter={(key, value) => dispatch(toggleCandidateFilter({ key, value }))}
      />

      <CandidateDetailsDialog
        open={selectedCandidateId !== null}
        candidate={revealed}
        isLoading={revealState.isFetching}
        error={revealState.error}
        onRetry={() => {
          if (selectedCandidateId) {
            void openCandidateProfile(selectedCandidateId);
          }
        }}
        onClose={closeCandidateProfile}
      />
    </div>
  );
}
