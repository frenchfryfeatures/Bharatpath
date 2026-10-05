"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";

import type {
  ApplicationColumnDefinition,
  EmployerApplication,
} from "../types";

import {
  APPLICATION_COLUMNS,
} from "../data";

import { InvitationColumn } from "./invitation-column";

import { ApplicationColumn } from "./application-column";

interface ApplicationPipelineProps {
  applications: EmployerApplication[];
  jobId?: string;
  loadedApplicationCount: number;
  hasNextPage: boolean;
  isLoadingMore: boolean;
  onLoadMore: () => void;

  onApplicationClick: (
    id: string,
  ) => void;

  onApplicationDrop: (
    applicationId: string,
    column: ApplicationColumnDefinition,
  ) => void;
}

export function ApplicationPipeline({
  jobId,
  applications,
  loadedApplicationCount,
  hasNextPage,
  isLoadingMore,
  onLoadMore,
  onApplicationClick,
  onApplicationDrop,
}: ApplicationPipelineProps) {
  const columns = useMemo(() => {
    return APPLICATION_COLUMNS.map(
      (column) => {
        const items =
          applications.filter(
            (application) => {
              if (
                application.stage !==
                column.stage
              ) {
                return false;
              }

              if (column.outcome !== undefined) {
                return (
                  application.outcome ===
                  column.outcome
                );
              }

              return true;
            },
          );

        return {
          column,
          applications: items,
        };
      },
    );
  }, [applications]);

  return (
    <div
      className="
        relative
        h-full
        min-h-0
        flex-1
      "
    >
      <div
        className="
          h-full
          min-h-0
          overflow-x-auto
          overflow-y-hidden
          pb-2
        "
      >
        <div className="flex h-full min-w-max gap-3">
          <InvitationColumn status="INVITED" jobId={jobId} />
          <InvitationColumn status="DECLINED" jobId={jobId} />
          {columns.map(
            ({
              column,
              applications: items,
            }) => (
              <ApplicationColumn
                key={column.id}
                column={column}
                applications={items}
                loadedApplicationCount={loadedApplicationCount}
                hasNextPage={hasNextPage}
                isLoadingMore={isLoadingMore}
                onLoadMore={onLoadMore}
                onApplicationClick={
                  onApplicationClick
                }
                onApplicationDrop={onApplicationDrop}
              />
            ),
          )}
        </div>
      </div>

      {isLoadingMore ? (
        <div
          role="status"
          className="
            pointer-events-none
            absolute
            bottom-4
            left-1/2
            flex
            -translate-x-1/2
            items-center
            gap-2
            rounded-full
            border
            border-[#dce2ea]
            bg-white/95
            px-3
            py-2
            text-[11px]
            font-semibold
            text-[#687384]
            shadow-sm
          "
        >
          <Loader2 aria-hidden="true" size={14} className="animate-spin" />
          Loading more applicants
        </div>
      ) : null}
    </div>
  );
}
