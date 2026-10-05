"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";
import { useCursorLoadMore } from "@/lib/pagination/use-cursor-load-more";
import {
  useAppDispatch,
  useAppSelector,
} from "@/store/hooks";

import {
  selectFilteredEmployerApplications,
  selectEmployerApplications,
  selectApplicationJobFilter,
  selectOpenApplication,
  setApplicationJobFilter,
  openApplication,
  closeApplication,
  moveApplicationStage,
  setMeetingLink,
  replaceApplications,
  appendApplications,
  replaceApplication,
  useLazyGetEmployerApplicationsQuery,
  useLazyGetEmployerApplicationQuery,
  useMoveEmployerApplicationMutation,
  useProposeEmployerHireMutation,
} from "@/store/employer/applications";
import { useGetEmployerJobQuery, useLazyGetEmployerJobsQuery } from "@/store/employer/jobs";
import type {
  ApplicationColumnDefinition,
  EmployerApplication,
} from "../types";

import { canMoveApplicationStage } from "../transitions";

const APPLICATIONS_PAGE_SIZE = 50;
const JOB_OPTIONS_PAGE_SIZE = 10;

interface ApplicationBatch {
  items: EmployerApplication[];
  nextCursor: string | null;
}

export function useApplicationsPage() {
  const dispatch = useAppDispatch();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const handleRefresh = useCallback(() => setRefreshVersion((value) => value + 1), []);
  const [stageErrorToast, setStageErrorToast] = useState<number | null>(null);
  const stageErrorToastId = useRef(0);
  const showStageError = useCallback(() => {
    setStageErrorToast(++stageErrorToastId.current);
  }, []);
  const dismissStageError = useCallback(() => setStageErrorToast(null), []);

  useEffect(() => {
    if (stageErrorToast === null) return;
    const timeout = window.setTimeout(dismissStageError, 4_000);
    return () => window.clearTimeout(timeout);
  }, [stageErrorToast, dismissStageError]);
  const searchParams = useSearchParams();
  const jobIdParam = searchParams.get("jobId");
  const [loadApplications, applicationsState] =
    useLazyGetEmployerApplicationsQuery();
  const [loadApplication] =
    useLazyGetEmployerApplicationQuery();
  const [moveApplication, moveState] =
    useMoveEmployerApplicationMutation();
  const [proposeHire, proposeState] =
    useProposeEmployerHireMutation();
  const jobFilter = useAppSelector(
    selectApplicationJobFilter,
  );

  // A `?jobId=` arriving from the jobs table selects that job locally. The
  // organisation-wide cursor remains the only list request.
  useEffect(() => {
    dispatch(setApplicationJobFilter(jobIdParam ?? "all"));
  }, [jobIdParam, dispatch]);

  const selectedJobId = jobFilter === "all" ? undefined : jobFilter;
  const [jobSearch, setJobSearch] = useState("");
  const [jobMenuOpen, setJobMenuOpen] = useState(false);
  const typedJobSearch = jobSearch.trim();
  const debouncedJobSearch = useDebouncedSearch(jobSearch);
  const [loadJobs, jobsSearchState] = useLazyGetEmployerJobsQuery();
  const jobOptionPages = useCursorLoadMore(
    useCallback(
      async (cursor: string | undefined) => {
        const page = await loadJobs({
          q: debouncedJobSearch || undefined,
          cursor,
          limit: JOB_OPTIONS_PAGE_SIZE,
        }).unwrap();
        return {
          items: page.items,
          nextCursor: page.nextCursor,
        };
      },
      [debouncedJobSearch, loadJobs],
    ),
    [debouncedJobSearch],
    jobMenuOpen,
  );

  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  const requestGenerationRef = useRef(0);

  const applications = useAppSelector(
    selectFilteredEmployerApplications,
  );
  const allApplications = useAppSelector(
    selectEmployerApplications,
  );

  // The focused job's title comes from the job itself, not from whichever
  // applications or dropdown page happen to be loaded yet.
  const selectedJobQuery = useGetEmployerJobQuery(selectedJobId ?? "", {
    skip: !selectedJobId,
  });
  const selectedJobTitle = selectedJobId
    ? selectedJobQuery.data?.title ??
      jobOptionPages.items.find((job) => job.id === selectedJobId)?.title ??
      null
    : null;
  const isSelectedJobTitleLoading =
    Boolean(selectedJobId) &&
    !selectedJobTitle &&
    (selectedJobQuery.isLoading || selectedJobQuery.isFetching);

  const jobOptions = useMemo(() => {
    const jobs = new Map<string, string>();

    if (selectedJobId) {
      jobs.set(
        selectedJobId,
        selectedJobTitle ??
          (isSelectedJobTitleLoading ? "Loading job…" : "Selected job"),
      );
    }

    for (const job of jobOptionPages.items) {
      jobs.set(job.id, job.title);
    }

    return [
      { value: "all", label: "All jobs" },
      ...Array.from(jobs, ([value, label]) => ({ value, label })),
    ];
  }, [
    isSelectedJobTitleLoading,
    jobOptionPages.items,
    selectedJobId,
    selectedJobTitle,
  ]);

  const loadApplicationBatch = useCallback(
    async (cursor?: string): Promise<ApplicationBatch> => {
      return loadApplications({
        cursor,
        limit: APPLICATIONS_PAGE_SIZE,
      }).unwrap();
    },
    [loadApplications],
  );

  useEffect(() => {
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    loadingMoreRef.current = false;
    let active = true;

    void (async () => {
      setNextCursor(null);
      setIsLoadingMore(false);
      setIsInitialLoading(true);
      dispatch(replaceApplications([]));

      const batch = await loadApplicationBatch();

      if (active && requestGenerationRef.current === generation) {
        dispatch(replaceApplications(batch.items));
        setNextCursor(batch.nextCursor);
      }
    })()
      .catch(() => undefined)
      .finally(() => {
        if (active && requestGenerationRef.current === generation) {
          setIsInitialLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [
    dispatch,
    loadApplicationBatch,
    refreshVersion,
  ]);

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor || loadingMoreRef.current) {
      return;
    }

    const generation = requestGenerationRef.current;
    loadingMoreRef.current = true;
    setIsLoadingMore(true);

    try {
      const batch = await loadApplicationBatch(nextCursor);

      if (requestGenerationRef.current !== generation) {
        return;
      }

      dispatch(appendApplications(batch.items));
      setNextCursor(batch.nextCursor);
    } catch {
      // The RTK Query error is exposed by the hook and rendered by the page.
    } finally {
      if (requestGenerationRef.current === generation) {
        loadingMoreRef.current = false;
        setIsLoadingMore(false);
      }
    }
  }, [
    dispatch,
    loadApplicationBatch,
    nextCursor,
  ]);

  const isLoading =
    isInitialLoading ||
    (applications.length === 0 &&
      applicationsState.isUninitialized);

  /*
   * ============================================================
   * APPLICATIONS
   * ============================================================
   */

  /*
   * ============================================================
   * JOB FILTER
   * ============================================================
   */

  /*
   * ============================================================
   * CURRENTLY OPEN APPLICATION
   * ============================================================
   *
   * This is used internally by the handlers below.
   */

  const selectedApplicationFromStore = useAppSelector(selectOpenApplication);
  const selectedApplication = useMemo(
    () =>
      applications.find(
        (application) => application.id === selectedApplicationFromStore?.id,
      ) ?? selectedApplicationFromStore,
    [applications, selectedApplicationFromStore],
  );

  /*
   * ============================================================
   * JOB FILTER
   * ============================================================
   */

  const handleJobFilterChange = useCallback(
    (value: string) => {
      if (value === jobFilter) {
        return;
      }
      dispatch(
        setApplicationJobFilter(value),
      );
    },
    [dispatch, jobFilter],
  );
  const handleJobSearchChange = useCallback((value: string) => {
    setJobSearch(value);
  }, []);
  const handleJobMenuOpenChange = useCallback((open: boolean) => {
    setJobMenuOpen(open);
  }, []);

  /*
   * ============================================================
   * OPEN APPLICATION
   * ============================================================
   */

  const handleOpenApplication = useCallback(
    (id: string) => {
      dispatch(openApplication(id));
      void loadApplication(id)
        .unwrap()
        .then((application) => {
          dispatch(replaceApplication(application));
        })
        .catch(() => undefined);
    },
    [dispatch, loadApplication],
  );

  /*
   * ============================================================
   * CLOSE APPLICATION
   * ============================================================
   */

  const handleCloseApplication =
    useCallback(() => {
      dispatch(closeApplication());
    }, [dispatch]);

  /*
   * ============================================================
   * MOVE APPLICATION STAGE
   * ============================================================
   */

  const handleMoveStage = useCallback(
    (
      stage: Parameters<
        typeof moveApplicationStage
      >[0]["stage"],
    ) => {
      if (!selectedApplication) {
        return;
      }
      if (!canMoveApplicationStage(selectedApplication, stage)) {
        showStageError();
        return;
      }

      const apiStage = {
        1: "VIEWED",
        2: "SHORTLISTED",
        3: "INTERVIEW",
        4: "DECISION",
      } as const;
      const target = apiStage[stage as keyof typeof apiStage];

      if (!target) {
        showStageError();
        return;
      }

      void moveApplication({
        applicationId: selectedApplication.id,
        stage: target,
      })
        .unwrap()
        .then((application) => {
          dispatch(replaceApplication(application));
        })
        .catch(showStageError);
    },
    [dispatch, moveApplication, selectedApplication, showStageError],
  );

  const handleMoveToColumn = useCallback(
    (applicationId: string, column: ApplicationColumnDefinition) => {
      const application = applications.find(
        (item) => item.id === applicationId,
      );

      if (!application) {
        return;
      }

      // Dropping back into the same column is not a stage change.
      if (application.stage === column.stage &&
        (column.outcome === undefined || application.outcome === column.outcome)) {
        return;
      }

      if (application.outcome !== null) {
        showStageError();
        return;
      }

      if (
        column.outcome !== "rejected" &&
        (column.outcome !== undefined && column.outcome !== null ||
          !canMoveApplicationStage(application, column.stage))
      ) {
        showStageError();
        return;
      }

      let target:
        | "VIEWED"
        | "SHORTLISTED"
        | "INTERVIEW"
        | "DECISION"
        | "REJECTED"
        | undefined;

      if (column.outcome === "rejected") {
        target = "REJECTED";
      } else if (column.stage === 1) {
        target = "VIEWED";
      } else if (column.stage === 2) {
        target = "SHORTLISTED";
      } else if (column.stage === 3) {
        target = "INTERVIEW";
      } else if (column.stage === 4 && column.outcome === null) {
        target = "DECISION";
      }

      if (!target) {
        showStageError();
        return;
      }

      void moveApplication({ applicationId, stage: target })
        .unwrap()
        .then((updatedApplication) => {
          dispatch(replaceApplication(updatedApplication));
        })
        .catch(showStageError);
    },
    [applications, dispatch, moveApplication, showStageError],
  );

  /*
   * ============================================================
   * MEETING LINK
   * ============================================================
   */

  const handleMeetingLinkChange =
    useCallback(
      (meetingLink: string) => {
        if (!selectedApplication) {
          return;
        }

        dispatch(
          setMeetingLink({
            applicationId:
              selectedApplication.id,
            meetingLink,
          }),
        );
      },
      [dispatch, selectedApplication],
    );

  /*
   * ============================================================
   * CONFIRM HIRE
   * ============================================================
   */

  const handleConfirmHire =
    useCallback(() => {
      if (!selectedApplication) {
        return;
      }

      void proposeHire(selectedApplication.id)
        .unwrap()
        .then((application) => {
          dispatch(replaceApplication(application));
        })
        .catch(() => undefined);
    }, [dispatch, proposeHire, selectedApplication]);

  /*
   * ============================================================
   * RETURN PAGE DATA + HANDLERS
   * ============================================================
   */

  return {
    refreshVersion,
    handleRefresh,
    stageErrorToast,
    dismissStageError,
    applications,
    loadedApplicationCount: allApplications.length,
    pageSize: APPLICATIONS_PAGE_SIZE,
    isLoading,
    isLoadingMore,
    jobFilter,
    jobSearch,
    jobOptions,
    isSearchingJobs:
      jobMenuOpen &&
      (jobOptionPages.isLoading ||
        typedJobSearch !== debouncedJobSearch),
    isLoadingMoreJobOptions: jobOptionPages.isLoadingMore,
    jobOptionsHaveMore: jobOptionPages.hasMore,
    selectedJobTitle,
    hasNextPage: nextCursor !== null,
    selectedApplication,
    isSelectedJobTitleLoading,
    error:
      applicationsState.error ??
      jobOptionPages.error ??
      jobsSearchState.error ??
      moveState.error ??
      proposeState.error,

    handleJobFilterChange,
    handleJobSearchChange,
    handleJobMenuOpenChange,
    handleLoadMoreJobOptions: jobOptionPages.loadMore,
    handleLoadMore,
    handleOpenApplication,
    handleCloseApplication,
    handleMoveStage,
    handleMoveToColumn,
    handleMeetingLinkChange,
    handleConfirmHire,
  };
}
