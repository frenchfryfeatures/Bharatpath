"use client";

import Link from "next/link";
import { Phone, Mail } from "lucide-react";

import { DataTable } from "@/components/ui/table";
import type { ColumnDef } from "@/components/ui/table";
import { humanizeCode } from "@/lib/format/labels";
import type { LeadRow, LeadStage } from "@/store/api/admin-api";

import type { UsersPagination } from "../types";
import type { LeadTab } from "../hooks/use-leads";

export type { LeadTab };

export const LEAD_TABS: ReadonlyArray<{ key: LeadTab; label: string }> = [
  { key: "others", label: "Active members" },
  { key: "signed_up", label: "Unpaid" },
];

/** Where the person stopped, in words a salesperson says out loud. */
const STAGE: Record<LeadStage, { label: string; hint: string; tone: string }> = {
  SIGNED_UP: {
    label: "Signed up",
    hint: "Has an account, nothing else yet",
    tone: "bg-[#f0f2f5] text-[#687182]",
  },
  PROFILE_COMPLETE: {
    label: "Profile complete",
    hint: "Answered the onboarding questions",
    tone: "bg-[#eef0ff] text-[#385da8]",
  },
  RESUME_DOWNLOADED: {
    label: "Resume downloaded",
    hint: "Built and downloaded a resume, has not paid",
    tone: "bg-[#fff5df] text-[#9a6b18]",
  },
  COLLEGE_SEAT: {
    label: "College seat",
    hint: "Has access through a college",
    tone: "bg-[#eef7f1] text-[#2f7b4b]",
  },
  PAID: {
    label: "Paid",
    hint: "Has a subscription",
    tone: "bg-[#eef7f1] text-[#2f7b4b]",
  },
};

function initialsOf(name: string | null): string {
  const letters = (name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return letters || "-";
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

interface LeadsTabProps {
  tab: LeadTab;
  leads: LeadRow[];
  isLoading?: boolean;
  searching: boolean;
  pagination: UsersPagination;
}

export function LeadsTab({ tab, leads, isLoading, searching, pagination }: LeadsTabProps) {
  const followUp = tab === "signed_up";

  const columns: ColumnDef<LeadRow>[] = [
    {
      id: "subject",
      header: "Candidate",
      headerClassName: "min-w-[240px]",
      cellClassName: "min-w-[240px]",
      cell: (lead) => (
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#f0f2f5] text-[10px] font-bold text-[#172033]">
            {initialsOf(lead.full_name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold leading-5 text-[#172033]">
              {lead.full_name ?? "Unnamed candidate"}
            </p>
            <p className="truncate text-[11px] leading-4 text-[#7b8494]">
              {[lead.city, lead.locale ? `Speaks ${lead.locale.toUpperCase()}` : null]
                .filter(Boolean)
                .join(" · ") || "Candidate"}
            </p>
          </div>
        </div>
      ),
    },

    {
      id: "contact",
      header: "Contact",
      headerClassName: "min-w-[230px]",
      cellClassName: "min-w-[230px]",
      cell: (lead) => (
        <div className="flex min-w-0 flex-col gap-1 text-[12px] text-[#344054]">
          {lead.phone ? (
            <a href={`tel:${lead.phone}`} className="inline-flex w-fit items-center gap-1.5 hover:text-[#315c9f]">
              <Phone className="h-3 w-3 shrink-0 text-[#7b8494]" aria-hidden="true" />
              {lead.phone}
            </a>
          ) : null}
          {lead.email ? (
            <a href={`mailto:${lead.email}`} className="inline-flex w-fit max-w-full items-center gap-1.5 hover:text-[#315c9f]">
              <Mail className="h-3 w-3 shrink-0 text-[#7b8494]" aria-hidden="true" />
              <span className="truncate">{lead.email}</span>
            </a>
          ) : null}
          {!lead.phone && !lead.email ? <span className="text-[#7b8494]">No contact on file</span> : null}
        </div>
      ),
    },

    {
      id: "stage",
      header: followUp ? "Where they stopped" : "Plan",
      headerClassName: "min-w-[200px]",
      cellClassName: "min-w-[200px]",
      cell: (lead) => {
        const stage = STAGE[lead.stage] ?? { label: humanizeCode(lead.stage), hint: "", tone: "bg-[#f0f2f5] text-[#687182]" };
        const downloads = lead.resume_builder.download_count;
        return (
          <div className="flex flex-col items-start gap-1">
            <span
              title={stage.hint}
              className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${stage.tone}`}
            >
              {stage.label}
            </span>
            {followUp && lead.stage === "RESUME_DOWNLOADED" ? (
              <span className="text-[11px] text-[#7b8494]">
                {downloads} {downloads === 1 ? "download" : "downloads"}
                {lead.resume_builder.last_downloaded_at
                  ? ` · last ${formatDate(lead.resume_builder.last_downloaded_at)}`
                  : ""}
              </span>
            ) : null}
            {followUp && lead.stage !== "RESUME_DOWNLOADED" && lead.has_uploaded_resume ? (
              <span className="text-[11px] text-[#7b8494]">Uploaded a CV</span>
            ) : null}
            {lead.contact_suppressed ? (
              <span
                title="Staff already stopped contacting this person. Leave them alone."
                className="inline-flex whitespace-nowrap rounded-full bg-[#fff0f1] px-2 py-0.5 text-[10px] font-semibold text-[#c92f3f]"
              >
                Do not contact
              </span>
            ) : null}
          </div>
        );
      },
    },

    {
      id: "joined",
      header: "Signed up",
      headerClassName: "min-w-[120px]",
      cellClassName: "min-w-[120px] whitespace-nowrap text-[12px] text-[#7b8494]",
      cell: (lead) => formatDate(lead.signed_up_at),
    },

    {
      id: "actions",
      header: "Actions",
      headerClassName: "min-w-[100px]",
      cellClassName: "min-w-[100px]",
      cell: (lead) => (
        <Link
          href={`/admin/users/${lead.id}`}
          className="cursor-pointer whitespace-nowrap rounded-lg border border-[#e2e5eb] bg-white px-3 py-2 text-[11px] font-semibold text-[#172033] transition-colors hover:bg-[#f8f9fb]"
        >
          View
        </Link>
      ),
    },
  ];

  return (
    <DataTable<LeadRow>
      columns={columns}
      data={leads}
      keyExtractor={(lead) => lead.id}
      paginationMode="cursor"
      pageSize={pagination.pageSize}
      currentPage={pagination.currentPage}
      hasNextPage={pagination.hasNextPage}
      onNextPage={pagination.onNextPage}
      onPreviousPage={pagination.onPreviousPage}
      onPageSizeChange={pagination.onPageSizeChange}
      itemLabel="candidates"
      emptyTitle={followUp ? "No one is waiting for a follow-up" : "No paid candidates yet"}
      emptySubtitle={
        searching
          ? "Nothing on this page matches. Search covers the page that is open; use Next to look further."
          : followUp
            ? "Everyone who signed up has paid or joined through a college."
            : "Candidates who pay or get a college seat appear here."
      }
      isLoading={isLoading}
    />
  );
}
