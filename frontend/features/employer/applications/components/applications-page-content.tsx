"use client";

import { useMemo } from "react";
import { AlertCircle, X } from "lucide-react";

import {
  ApplicationPipeline,
  ApplicationFilter,
  ApplicationDrawer,
  ApplicationsPipelineSkeleton,
} from "@/features/employer/applications";
import { useConfirmDialog } from "@/features/employer/components/use-confirm-dialog";
import { EmployerErrorState } from "@/features/employer/components/employer-error-state";
import {
  usePageHeader,
  type Breadcrumb,
} from "@/components/layout/header-context";

import { useApplicationsPage } from "../hooks/use-applications-page";

export function ApplicationsPageContent() {
  const {
    refreshVersion,
    handleRefresh,
    stageErrorToast,
    dismissStageError,
    applications,
    loadedApplicationCount,
    pageSize,
    isLoading,
    isLoadingMore,
    jobFilter,
    jobSearch,
    jobOptions,
    isSearchingJobs,
    isLoadingMoreJobOptions,
    jobOptionsHaveMore,
    selectedJobTitle,
    isSelectedJobTitleLoading,
    hasNextPage,
    selectedApplication,
    error,

    handleJobFilterChange,
    handleJobSearchChange,
    handleJobMenuOpenChange,
    handleLoadMoreJobOptions,
    handleLoadMore,
    handleOpenApplication,
    handleCloseApplication,
    handleMoveStage,
    handleMoveToColumn,
    handleMeetingLinkChange,
    handleConfirmHire,
  } = useApplicationsPage();
  const { confirm, dialog } = useConfirmDialog();

  // Rejecting (a drop on the Rejected column) and marking a hire involve the
  // candidate and cannot be taken back, so each is confirmed first.
  const handleDropWithConfirm: typeof handleMoveToColumn = (
    applicationId,
    column,
  ) => {
    if (column.outcome !== "rejected") {
      handleMoveToColumn(applicationId, column);
      return;
    }

    confirm({
      title: "Reject this application?",
      description:
        "The candidate will be told their application was not taken forward. This cannot be undone.",
      confirmLabel: "Reject application",
      tone: "danger",
      onConfirm: () => handleMoveToColumn(applicationId, column),
    });
  };

  const askConfirmHire = () =>
    confirm({
      title: "Mark this candidate as hired?",
      description:
        "This confirms the hire from your side. The candidate then confirms separately before it counts as a billable hire.",
      confirmLabel: "Mark as hired",
      onConfirm: handleConfirmHire,
    });

  // When a specific job is in focus (a stage number was clicked on the jobs
  // table), show `Jobs > {job} > Applications`, matching the approved design.
  // While the job's title loads, that crumb is a skeleton, never a guess.
  const breadcrumbs = useMemo<Breadcrumb[] | undefined>(() => {
    if (jobFilter === "all" || (!selectedJobTitle && !isSelectedJobTitleLoading)) {
      return undefined;
    }
    return [
      { label: "Jobs", href: "/employer/jobs" },
      selectedJobTitle
        ? { label: selectedJobTitle }
        : { label: "Loading job", isLoading: true },
      { label: "Applications" },
    ];
  }, [isSelectedJobTitleLoading, jobFilter, selectedJobTitle]);

  usePageHeader(
    "Applications",
    "Track applicants through your hiring pipeline",
    { breadcrumbs },
  );

  return (
    <div
      className="
        flex
        h-full
        min-h-0
        flex-col
        bg-[#f8f9fb]
        p-4
      "
    >
      {/* =====================================================
          FILTER
      ====================================================== */}

      <div
        className="
          shrink-0
          bg-[#f8f9fb]
          pb-4
        "
      >
        <button type="button" onClick={handleRefresh} disabled={isLoading} className="mb-3 rounded-lg border border-[#d9dee7] bg-white px-3 py-2 text-xs font-semibold text-[#51449a]">Refresh applications & invitations</button>
        <ApplicationFilter
          value={jobFilter}
          total={applications.length}
          loadedTotal={loadedApplicationCount}
          pageSize={pageSize}
          hasNextPage={hasNextPage}
          isLoadingMore={isLoadingMore}
          options={jobOptions}
          search={jobSearch}
          isSearching={isSearchingJobs}
          isLoadingMoreJobOptions={isLoadingMoreJobOptions}
          jobOptionsHaveMore={jobOptionsHaveMore}
          onChange={handleJobFilterChange}
          onSearchChange={handleJobSearchChange}
          onJobMenuOpenChange={handleJobMenuOpenChange}
          onLoadMoreJobOptions={handleLoadMoreJobOptions}
          onLoadMore={handleLoadMore}
        />

        {error ? (
          <EmployerErrorState
            variant="inline"
            error={error}
            fallback="Something went wrong with that action. Please try again."
            className="mt-3"
          />
        ) : null}
      </div>

      {/* =====================================================
          PIPELINE
      ====================================================== */}

      <div
        className="
          min-h-0
          flex-1
          overflow-hidden
        "
      >
        {isLoading ? (
          <ApplicationsPipelineSkeleton />
        ) : (
          <ApplicationPipeline
            key={refreshVersion}
            jobId={jobFilter === "all" ? undefined : jobFilter}
            applications={applications}
            loadedApplicationCount={loadedApplicationCount}
            hasNextPage={hasNextPage}
            isLoadingMore={isLoadingMore}
            onLoadMore={handleLoadMore}
            onApplicationClick={
              handleOpenApplication
            }
            onApplicationDrop={handleDropWithConfirm}
          />
        )}
      </div>

      {/* =====================================================
          APPLICATION DRAWER
      ====================================================== */}

      <ApplicationDrawer
        application={selectedApplication}
        onClose={handleCloseApplication}
        onMoveStage={handleMoveStage}
        onMeetingLinkChange={
          handleMeetingLinkChange
        }
        onConfirmHire={askConfirmHire}
      />

      {dialog}
      {stageErrorToast !== null ? (
        <div
          role="alert"
          aria-atomic="true"
          className="fixed bottom-5 right-5 z-100 flex max-w-sm items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800 shadow-lg"
        >
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1 font-semibold">This task cannot be performed.</span>
          <button
            type="button"
            onClick={dismissStageError}
            aria-label="Dismiss message"
            className="grid h-7 w-7 place-items-center rounded-md hover:bg-red-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
