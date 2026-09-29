"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Armchair, Mail } from "lucide-react";
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
  StudentDetailDrawer,
  StudentFilters,
  StudentTable,
  type StudentStatus,
} from "./roster";
import {
  BulkUploadCard,
  RosterImportsCard,
} from "./roster-imports";
import { useStudents } from "./use-students";

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
    studentsPagination,
    seats,
    isLoadingSeats,
    referralCodes,
    isLoadingReferralCodes,
    referralCodesError,
    isLoadingMoreReferralCodes,
    hasMoreReferralCodes,
    referralCodesLoadMoreError,
    loadMoreReferralCodes,
    retryReferralCodes,
    rosterImports,
    rosterInvitationTotals,
    isLoadingRosterImports,
    rosterImportsError,
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
  const [viewingStudentId, setViewingStudentId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!initialRequestsLoading) {
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

  const seatLabel = seats
    ? `${seats.used} of ${seats.allocated} seats used`
    : "Seats";

  const seatProgress =
    seats && seats.allocated > 0
      ? (seats.used / seats.allocated) * 100
      : 0;

  usePageHeader(
    "Students",
    "Roster, invites, bulk upload and consent...",
    {
      stat: {
        icon: Armchair,
        label: seatLabel,
        progress: seatProgress,
        isLoading: isLoadingSeats,
      },
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
      <StudentTable
        students={students}
        currentPage={studentsPagination.currentPage}
        hasNextPage={studentsPagination.hasNextPage}
        onNextPage={studentsPagination.goToNextPage}
        onPreviousPage={studentsPagination.goToPreviousPage}
        isLoading={isLoadingStudents}
        onView={(student) => setViewingStudentId(student.candidateId)}
      />

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
          hasMore={hasMoreReferralCodes}
          isLoadingMore={isLoadingMoreReferralCodes}
          loadMoreError={referralCodesLoadMoreError}
          onLoadMore={loadMoreReferralCodes}
          onRetry={retryReferralCodes}
          onRevoke={(id) => revokeReferralCode(id).unwrap()}
          isRevoking={isRevokingCode}
        />
      </div>

      {/* 5. INVITE STUDENT MODAL — issues a referral code to hand out */}
      <InviteStudentModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        onIssueCode={(args) => issueReferralCode(args).unwrap()}
        isIssuing={isIssuingCode}
      />

      {/* 6. STUDENT DETAIL — audited open of a single visible student */}
      <StudentDetailDrawer
        candidateId={viewingStudentId}
        onClose={() => setViewingStudentId(null)}
      />
    </div>
  );
}