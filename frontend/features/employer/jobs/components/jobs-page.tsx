"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Dropdown } from "@/components/ui/dropdown";
import { EmployerErrorState } from "@/features/employer/components/employer-error-state";
import { usePageHeader } from "@/components/layout/header-context";

import { JobsTable } from "./jobs-table";
import {
    useGetEmployerJobsQuery,
    selectJobsSearch,
    selectJobsStatusFilter,
    setJobsSearch,
    setJobsStatusFilter,
} from "@/store/employer/jobs";
import type { JobsStatusFilter } from "@/store/employer/jobs";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useCursorPagination } from "@/lib/pagination/use-cursor-pagination";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";
import type { ApiJobStatus, EmployerJob } from "../types";

const DEFAULT_PAGE_SIZE = 10;
const EMPTY_JOBS: EmployerJob[] = [];
const STATUS_TO_API: Record<Exclude<JobsStatusFilter, "all">, ApiJobStatus> = {
    live: "PUBLISHED",
    draft: "DRAFT",
    paused: "PAUSED",
    closed: "CLOSED",
};

export function JobsPage() {
    const router = useRouter();
    const dispatch = useAppDispatch();

    /*
     * IMPORTANT:
     * The global PortalHeader is responsible for rendering:
     *
     * Jobs
     * Manage job postings and track how each one is performing
     *
     * Therefore there must NOT be another Jobs header inside this page.
     */
    usePageHeader(
        "Jobs",
        "Manage job postings and track how each one is performing"
    );

    const search = useAppSelector(selectJobsSearch);
    const statusFilter = useAppSelector(
        selectJobsStatusFilter
    );
    const debouncedSearch = useDebouncedSearch(search);
    const apiStatus =
        statusFilter === "all"
            ? undefined
            : STATUS_TO_API[statusFilter];
    const pagination = useCursorPagination(
        [debouncedSearch, apiStatus],
        DEFAULT_PAGE_SIZE,
    );
    const {
        currentData,
        isLoading,
        isFetching,
        isError,
        error,
    } = useGetEmployerJobsQuery(
        {
            status: apiStatus,
            q: debouncedSearch || undefined,
            cursor: pagination.cursor,
            limit: pagination.pageSize,
        },
        { refetchOnMountOrArgChange: true },
    );
    const employerJobs = currentData?.items ?? EMPTY_JOBS;
    const nextCursor = currentData?.nextCursor ?? null;

    const statusOptions = [
        {
            value: "all",
            label: "All statuses",
        },
        {
            value: "live",
            label: "Live",
        },
        {
            value: "draft",
            label: "Draft",
        },
        {
            value: "paused",
            label: "Paused",
        },
        {
            value: "closed",
            label: "Closed",
        },
    ] satisfies {
        value: JobsStatusFilter;
        label: string;
    }[];

    function handleSearch(value: string) {
        dispatch(setJobsSearch(value));
    }

    function handleStatusChange(
        value: JobsStatusFilter
    ) {
        dispatch(setJobsStatusFilter(value));
    }

    function handleViewApplicants(job: EmployerJob) {
        router.push(
            `/employer/applications?jobId=${job.id}`
        );
    }

    function handleViewJob(job: EmployerJob) {
        router.push(
            `/employer/jobs/${job.id}`
        );
    }

    function handleEditJob(job: EmployerJob) {
        router.push(
            `/employer/jobs/${job.id}/edit`
        );
    }

    return (
        <main className="min-h-full bg-[#f7f8fa]">
            <section
                className="
          overflow-hidden
          rounded-[12px]
          border
          border-[#e5e8ed]
          bg-white
          shadow-[0_2px_8px_rgba(19,26,38,0.02)]
        "
            >
                {/* Jobs toolbar */}
                <div
                    className="
            flex
            items-center
            gap-4
            border-b
            border-[#edf0f3]
            px-5
            py-3
          "
                >
                    {/* Filters */}
                    <div className="flex items-center gap-2">
                        {/* Search */}
                        <div className="relative">
                            <Search
                                size={15}
                                strokeWidth={1.8}
                                className="
                  pointer-events-none
                  absolute
                  left-3
                  top-1/2
                  -translate-y-1/2
                  text-[#777f90]
                "
                            />

                            <input
                                value={search}
                                onChange={(event) =>
                                    handleSearch(event.target.value)
                                }
                                placeholder="Search jobs"
                                className="
                  h-9
                  w-[207px]
                  rounded-[9px]
                  border
                  border-[#e3e6eb]
                  bg-white
                  pl-9
                  pr-3
                  text-[12px]
                  text-[#151b2b]
                  outline-none
                  placeholder:text-[#8a919d]
                  focus:border-[#b7b1ee]
                  focus:ring-2
                  focus:ring-[#5b4fcf]/10
                "
                            />
                        </div>

                        {/* Status */}
                        <Dropdown
                            value={statusFilter}
                            options={statusOptions}
                            onChange={handleStatusChange}
                            width="w-[130px]"
                        />
                    </div>
                </div>

                {isError ? (
                    <div className="px-5 py-14">
                        <EmployerErrorState
                            variant="block"
                            error={error}
                            title="Couldn't load jobs"
                            fallback="Something went wrong while fetching your job postings."
                        />
                    </div>
                ) : (
                    <JobsTable
                        jobs={employerJobs}
                        currentPage={pagination.currentPage}
                        pageSize={pagination.pageSize}
                        hasNextPage={Boolean(nextCursor)}
                        isLoading={isLoading || isFetching}
                        onNextPage={() => pagination.goToNextPage(nextCursor)}
                        onPreviousPage={pagination.goToPreviousPage}
                        onPageSizeChange={pagination.setPageSize}
                        onViewApplicants={handleViewApplicants}
                        onEditJob={handleEditJob}
                        onViewJob={handleViewJob}
                    />
                )}
            </section>
        </main>
    );
}