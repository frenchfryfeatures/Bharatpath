"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { Skeleton } from "@/components/common/loading";
import { usePageHeader } from "@/components/layout/header-context";
import { Button } from "@/components/ui/button";
import { useScrollToHash } from "@/lib/hooks/use-scroll-to-hash";

import { LinkStatesSummary } from "./link-states";
import {
  InviteStudentModal,
  ReferralCodesCard,
} from "./referral-codes";
import {
  StudentFilters,
  StudentTable,
  type StudentStatus,
} from "./roster";
import {
  BulkUploadCard,
  RosterImportsCard,
} from "./roster-imports";
import { useStudents } from "./use-students";
import { CollegeErrorState } from "@/features/college/components/college-error-state";
import { seatStat } from "@/features/college/seat-stat";

function StudentRosterSkeleton() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mx-auto max-w-7xl space-y-5"
      style={{ fontFamily: "'General Sans', sans-serif" }}
    >
      <span className="sr-only">Loading students…</span>

      <div className="flex flex-wrap items-center gap-3">
        <Skeleton className="h-10 w-full sm:w-[320px]" radius={10} />
        <Skeleton className="h-10 w-full sm:w-42.5" radius={10} />
      </div>

      <StudentTable
        students={[]}
        currentPage={1}
        hasNextPage={false}
        onNextPage={() => {}}
        onPreviousPage={() => {}}
        isLoading
      />

      <div className="grid grid-cols-1 gap-5 pt-1 md:grid-cols-2">
        <Skeleton className="h-85 w-full" radius={16} />
        <Skeleton className="h-85 w-full" radius={16} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Skeleton className="h-47.5 w-full" radius={16} />
        <Skeleton className="h-47.5 w-full" radius={16} />
      </div>
    </div>
  );
}

export function StudentRoster() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StudentStatus | "all">("all");
  const {
    students,
    isLoadingStudents,
    studentsError,
    studentsErrorValue,
    studentsPagination,
    seats,
    isLoadingSeats,
    referralCodes,
    isLoadingReferralCodes,
    referralCodesError,
    referralCodesErrorValue,
    isLoadingMoreReferralCodes,
    hasMoreReferralCodes,
    referralCodesLoadMoreError,
    loadMoreReferralCodes,
    retryReferralCodes,
    rosterImports,
    rosterInvitationTotals,
    isLoadingRosterImports,
    rosterImportsError,
    rosterImportsErrorValue,
    isLoadingMoreRosterImports,
    hasMoreRosterImports,
    rosterImportsLoadMoreError,
    loadMoreRosterImports,
    retryRosterImports,
    issueReferralCode,
    isIssuingCode,
    revokeReferralCode,
    isRevokingCode,
    uploadRosterImport,
    commitRosterImport,
    isCommittingRoster,
    discardRosterImport,
    isDiscardingRoster,
    sendRosterInvitations,
    isSendingInvitations,
  } = useStudents(search, status);
  const initialRequestsLoading =
    isLoadingStudents ||
    isLoadingSeats ||
    isLoadingReferralCodes ||
    isLoadingRosterImports;
  const [hasResolvedInitialLoad, setHasResolvedInitialLoad] = useState(false);

  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  useEffect(() => {
    if (!initialRequestsLoading) {
      // Preserve the roster after its first load while later queries refresh.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHasResolvedInitialLoad(true);
    }
  }, [initialRequestsLoading]);

  const showInitialSkeleton =
    !hasResolvedInitialLoad && initialRequestsLoading;

  useScrollToHash(
    !isLoadingStudents && !isLoadingRosterImports && !isLoadingReferralCodes,
  );

  const linkedCount = students.filter(
    (student) => student.status === "linked",
  ).length;

  const invitedCount = rosterInvitationTotals.sent;
  const consentPendingCount = rosterInvitationTotals.accepted;

  const headerAction = useMemo(
    () => (
      <Button
        type="button"
        variant="primary"
        size="md"
        icon={<Mail size={15} strokeWidth={2.2} />}
        onClick={() => setIsInviteModalOpen(true)}
        disabled={showInitialSkeleton}
        className="shadow-sm"
      >
        Invite students
      </Button>
    ),
    [showInitialSkeleton],
  );

  usePageHeader(
    "Students",
    "Roster, invites, bulk upload and consent...",
    {
      stat: seatStat(seats, isLoadingSeats),
      action: headerAction,
    },
  );

  if (showInitialSkeleton) {
    return <StudentRosterSkeleton />;
  }

  return (
    <div
      className="mx-auto max-w-7xl space-y-5"
      style={{ fontFamily: "'General Sans', sans-serif" }}
    >
      {/* 1. FILTER & SEARCH BAR */}
      <StudentFilters
        search={search}
        onSearchChange={setSearch}
        status={status}
        onStatusChange={setStatus}
      />

      {/* 2. STUDENT ROSTER TABLE CARD */}
      {studentsError ? (
        <CollegeErrorState
          error={studentsErrorValue}
          title="Students unavailable"
          fallback="The student roster could not be loaded."
        />
      ) : (
      <StudentTable
        students={students}
        currentPage={studentsPagination.currentPage}
        hasNextPage={studentsPagination.hasNextPage}
        onNextPage={studentsPagination.goToNextPage}
        onPreviousPage={studentsPagination.goToPreviousPage}
        isLoading={isLoadingStudents}
        onView={(student) => {
          if (student.candidateId) router.push(`/college/students/${student.candidateId}`);
        }}
      />
      )}

      {/* 3. BOTTOM CARDS: BULK UPLOAD & LINK STATES */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1">
        <BulkUploadCard
          onUpload={uploadRosterImport}
        />
        <LinkStatesSummary
          linkedCount={linkedCount}
          invitedCount={invitedCount}
          consentPendingCount={consentPendingCount}
          isLoading={isLoadingStudents || isLoadingRosterImports}
        />
      </div>

      {/* 4. ROSTER IMPORT PIPELINE & REFERRAL CODES */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <RosterImportsCard
          imports={rosterImports}
          isLoading={isLoadingRosterImports}
          isError={rosterImportsError}
          error={rosterImportsErrorValue}
          hasMore={hasMoreRosterImports}
          isLoadingMore={isLoadingMoreRosterImports}
          loadMoreError={rosterImportsLoadMoreError}
          onLoadMore={loadMoreRosterImports}
          onRetry={retryRosterImports}
          onViewRows={(import_) =>
            router.push(
              `/college/students/roster-imports/${import_.id}`,
            )
          }
          onCommit={commitRosterImport}
          isCommitting={isCommittingRoster}
          onDiscard={discardRosterImport}
          isDiscarding={isDiscardingRoster}
          onSend={(id) => sendRosterInvitations(id).unwrap()}
          isSending={isSendingInvitations}
        />
        <ReferralCodesCard
          codes={referralCodes}
          isLoading={isLoadingReferralCodes}
          isError={referralCodesError}
          error={referralCodesErrorValue}
          hasMore={hasMoreReferralCodes}
          isLoadingMore={isLoadingMoreReferralCodes}
          loadMoreError={referralCodesLoadMoreError}
          onLoadMore={loadMoreReferralCodes}
          onRetry={retryReferralCodes}
          onRevoke={(id) => revokeReferralCode(id).unwrap()}
          isRevoking={isRevokingCode}
        />
      </div>

      {/* 5. INVITE STUDENT MODAL - issues a referral code to hand out */}
      <InviteStudentModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        onIssueCode={(args) => issueReferralCode(args).unwrap()}
        isIssuing={isIssuingCode}
      />

    </div>
  );
}
