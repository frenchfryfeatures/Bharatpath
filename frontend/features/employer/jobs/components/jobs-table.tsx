"use client";

import {
  Eye,
  Pencil,
  Users,
  ChevronRight,
} from "lucide-react";

import {
  DataTable,
  type ColumnDef,
} from "@/components/ui/table";

import type { EmployerJob, JobStatus } from "../types";

interface JobsTableProps {
  jobs: EmployerJob[];
  currentPage: number;
  pageSize: number;
  hasNextPage: boolean;
  isLoading?: boolean;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onPageSizeChange: (pageSize: number) => void;
  onViewApplicants: (job: EmployerJob) => void;
  onEditJob: (job: EmployerJob) => void;
  onViewJob: (job: EmployerJob) => void;
}

function formatSalary(min: number, max: number) {
  const minLpa = (min * 12) / 100000;
  const maxLpa = (max * 12) / 100000;

  return `₹${minLpa.toFixed(1)}–${maxLpa.toFixed(1)} LPA`;
}

function StatusBadge({
  status,
}: Readonly<{ status: JobStatus }>) {
  const config = {
    live: {
      label: "Live",
      className:
        "bg-[#eaf6f0] text-[#1f7a4d]",
    },
    draft: {
      label: "Draft",
      className:
        "bg-[#edf3fc] text-[#3566b8]",
    },
    paused: {
      label: "Paused",
      className:
        "bg-[#fdf2e0] text-[#a15c00]",
    },
    closed: {
      label: "Closed",
      className:
        "bg-[#f4f5f7] text-[#5d6673]",
    },
  };

  const item = config[status];

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${item.className}`}
    >
      {item.label}
    </span>
  );
}

function CountButton({
  value,
  disabled = false,
  onClick,
}: Readonly<{
  value: number;
  disabled?: boolean;
  onClick?: () => void;
}>) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={[
        "inline-flex min-w-10 items-center justify-center",
        "gap-1 rounded-full px-2.5 py-1",
        "text-[12px] font-medium",
        "transition-colors",
        disabled
          ? "bg-[#fafbfc] text-[#c5c9d0] cursor-default"
          : "bg-[#f6f7f9] text-[#151b2b] hover:bg-[#eef1f5]",
      ].join(" ")}
    >
      <span>{value}</span>

      {!disabled && (
        <ChevronRight
          size={12}
          strokeWidth={2}
        />
      )}
    </button>
  );
}

function createJobColumns({
  onViewApplicants,
  onEditJob,
  onViewJob,
}: Pick<JobsTableProps, "onViewApplicants" | "onEditJob" | "onViewJob">): ColumnDef<EmployerJob>[] {
  return [
    {
      id: "job",
      header: "Job",
      cell: (job: EmployerJob) => (
        <button
          type="button"
          onClick={() => onViewJob(job)}
          className="cursor-pointer text-left font-semibold text-[#151b2b] underline-offset-2 hover:underline"
        >
          {job.title}
        </button>
      ),
      headerClassName: "min-w-[220px]",
    },

    {
      id: "status",
      header: "Status",
      cell: (job: EmployerJob) => (
        <StatusBadge status={job.status} />
      ),
    },

    {
      id: "location",
      header: "Location",
      cell: (job: EmployerJob) => (
        <span className="whitespace-nowrap text-[#777f90]">
          {job.location.trim() || "Location not specified"}
        </span>
      ),
    },

    {
      id: "pay",
      header: "Pay",
      cell: (job: EmployerJob) => (
        <span className="whitespace-nowrap font-medium text-[#151b2b]">
          {formatSalary(job.salaryMin, job.salaryMax)}
        </span>
      ),
    },

    {
      id: "applicants",
      header: "Applicants",
      cell: (job: EmployerJob) => (
        <CountButton
          value={job.applicantsCount}
          disabled={job.applicantsCount === 0}
          onClick={() => onViewApplicants(job)}
        />
      ),
    },

    {
      id: "viewed",
      header: "Viewed",
      cell: (job: EmployerJob) => (
        <CountButton
          value={job.viewedCount}
          disabled={job.viewedCount === 0}
          onClick={() => onViewApplicants(job)}
        />
      ),
    },

    {
      id: "shortlisted",
      header: "Shortlisted",
      cell: (job: EmployerJob) => (
        <CountButton
          value={job.shortlistedCount}
          disabled={job.shortlistedCount === 0}
          onClick={() => onViewApplicants(job)}
        />
      ),
    },

    {
      id: "interview",
      header: "Interview",
      cell: (job: EmployerJob) => (
        <CountButton
          value={job.interviewCount}
          disabled={job.interviewCount === 0}
          onClick={() => onViewApplicants(job)}
        />
      ),
    },

    {
      id: "hired",
      header: "Hired",
      cell: (job: EmployerJob) => (
        <CountButton
          value={job.hiredCount}
          disabled={job.hiredCount === 0}
          onClick={() => onViewApplicants(job)}
        />
      ),
    },

    {
      id: "rejected",
      header: "Rejected",
      cell: (job: EmployerJob) => (
        <CountButton
          value={job.rejectedCount}
          disabled={job.rejectedCount === 0}
          onClick={() => onViewApplicants(job)}
        />
      ),
    },

    {
      id: "actions",
      header: "Actions",
      cell: (job: EmployerJob) => (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={`View applicants for ${job.title}`}
            onClick={() => onViewApplicants(job)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[#e2e5eb] bg-white text-[#151b2b] transition-colors hover:bg-[#f7f8fa]"
          >
            <Users size={15} strokeWidth={1.8} />
          </button>

          <button
            type="button"
            aria-label={`View ${job.title}`}
            onClick={() => onViewJob(job)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[#e2e5eb] bg-white text-[#151b2b] transition-colors hover:bg-[#f7f8fa]"
          >
            <Eye size={15} strokeWidth={1.8} />
          </button>

          <button
            type="button"
            aria-label={`Edit ${job.title}`}
            onClick={() => onEditJob(job)}
            className="grid h-8 w-8 place-items-center rounded-lg border border-[#e2e5eb] bg-white text-[#151b2b] transition-colors hover:bg-[#f7f8fa]"
          >
            <Pencil size={15} strokeWidth={1.8} />
          </button>
        </div>
      ),
    },
  ];
}

export function JobsTable({
  jobs,
  currentPage,
  pageSize,
  hasNextPage,
  isLoading = false,
  onNextPage,
  onPreviousPage,
  onPageSizeChange,
  onViewApplicants,
  onEditJob,
  onViewJob,
}: Readonly<JobsTableProps>) {
  const columns = createJobColumns({
    onViewApplicants,
    onEditJob,
    onViewJob,
  });

  return (
    <DataTable
      columns={columns}
      data={jobs}
      keyExtractor={(job) => job.id}
      paginationMode="cursor"
      pageSize={pageSize}
      currentPage={currentPage}
      hasNextPage={hasNextPage}
      onNextPage={onNextPage}
      onPreviousPage={onPreviousPage}
      onPageSizeChange={onPageSizeChange}
      itemLabel="jobs"
      isLoading={isLoading}
      emptyTitle={
        isLoading ? "Loading jobs…" : "No jobs found"
      }
      emptySubtitle={
        isLoading
          ? "Please wait while we fetch your job postings."
          : "Try changing your search or status filter."
      }
      className="overflow-x-auto"
    />
  );
}