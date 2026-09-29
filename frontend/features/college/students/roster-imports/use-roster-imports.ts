"use client";

import { useCallback, useMemo, useState } from "react";

import {
  collegeRosterImportsApi,
  useCommitRosterImportMutation,
  useDiscardRosterImportMutation,
  useGetRosterImportsInfiniteQuery,
  useSendRosterInvitationsMutation,
  useUploadRosterImportMutation,
  type InvitationCounts,
  type RosterImport,
} from "@/store/college/roster-imports";
import { useAppDispatch } from "@/store/hooks";

const EMPTY_INVITATION_COUNTS: InvitationCounts = {
  pending: 0,
  sent: 0,
  accepted: 0,
  declined: 0,
  expired: 0,
};

export function useRosterImports() {
  const dispatch = useAppDispatch();
  const query = useGetRosterImportsInfiniteQuery(undefined);
  const [uploadRosterImport, uploadState] =
    useUploadRosterImportMutation();
  const [commitRosterImport, commitState] =
    useCommitRosterImportMutation();
  const [discardRosterImport, discardState] =
    useDiscardRosterImportMutation();
  const [sendRosterInvitations, sendState] =
    useSendRosterInvitationsMutation();
  const [localImportSnapshots, setLocalImportSnapshots] =
    useState<RosterImport[]>([]);

  const cacheImport = useCallback(
    (updated: RosterImport, insertWhenMissing: boolean) => {
      setLocalImportSnapshots((current) => {
        const existingIndex = current.findIndex(
          (import_) => import_.id === updated.id,
        );

        if (existingIndex < 0) {
          return insertWhenMissing
            ? [updated, ...current]
            : [...current, updated];
        }

        return current.map((import_, index) =>
          index === existingIndex ? updated : import_,
        );
      });

      dispatch(
        collegeRosterImportsApi.util.updateQueryData(
          "getRosterImports",
          undefined,
          (draft) => {
            const existingPage = draft.pages.find((page) =>
              page.items.some((import_) => import_.id === updated.id),
            );
            const existingIndex = existingPage?.items.findIndex(
              (import_) => import_.id === updated.id,
            );

            if (
              existingPage &&
              existingIndex !== undefined &&
              existingIndex >= 0
            ) {
              existingPage.items[existingIndex] = updated;
              return;
            }

            if (insertWhenMissing) {
              draft.pages[0]?.items.unshift(updated);
            }
          },
        ),
      );
    },
    [dispatch],
  );

  const uploadRoster = useCallback(
    async (payload: {
      fileName: string;
      csv: string;
    }): Promise<RosterImport> => {
      const uploaded = await uploadRosterImport(payload).unwrap();
      cacheImport(uploaded, true);
      return uploaded;
    },
    [cacheImport, uploadRosterImport],
  );

  const commitRoster = useCallback(
    async (importId: string): Promise<RosterImport> => {
      const committed = await commitRosterImport(importId).unwrap();
      cacheImport(committed, false);
      return committed;
    },
    [cacheImport, commitRosterImport],
  );

  const discardRoster = useCallback(
    async (importId: string): Promise<RosterImport> => {
      const discarded = await discardRosterImport(importId).unwrap();
      cacheImport(discarded, false);
      return discarded;
    },
    [cacheImport, discardRosterImport],
  );

  const serverImports = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const rosterImports = useMemo(() => {
    if (localImportSnapshots.length === 0) {
      return serverImports;
    }

    const localImportsById = new Map(
      localImportSnapshots.map((import_) => [import_.id, import_]),
    );
    const serverImportIds = new Set(
      serverImports.map((import_) => import_.id),
    );

    return [
      ...localImportSnapshots.filter(
        (import_) => !serverImportIds.has(import_.id),
      ),
      ...serverImports.map(
        (import_) => localImportsById.get(import_.id) ?? import_,
      ),
    ];
  }, [localImportSnapshots, serverImports]);

  return {
    rosterImports,
    rosterInvitationTotals:
      query.data?.pages[0]?.invitationTotals ??
      EMPTY_INVITATION_COUNTS,
    isLoadingRosterImports: query.isLoading,
    rosterImportsError:
      rosterImports.length === 0 &&
      query.isError &&
      query.data === undefined,
    isLoadingMoreRosterImports: query.isFetchingNextPage,
    hasMoreRosterImports: query.hasNextPage,
    rosterImportsLoadMoreError:
      query.isError && query.data !== undefined,
    loadMoreRosterImports: () => {
      void query.fetchNextPage();
    },
    retryRosterImports: () => {
      void query.refetch();
    },
    uploadRosterImport: uploadRoster,
    isUploadingRoster: uploadState.isLoading,
    commitRosterImport: commitRoster,
    isCommittingRoster: commitState.isLoading,
    discardRosterImport: discardRoster,
    isDiscardingRoster: discardState.isLoading,
    sendRosterInvitations,
    isSendingInvitations: sendState.isLoading,
  };
}
