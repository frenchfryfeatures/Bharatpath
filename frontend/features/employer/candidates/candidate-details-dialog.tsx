"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BriefcaseBusiness,
  FileText,
  Mail,
  MapPin,
  Maximize2,
  Minimize2,
  Phone,
  UserRound,
  X,
} from "lucide-react";

import { EmployerErrorState } from "@/features/employer/components/employer-error-state";
import { ResumeShowcase } from "@/features/employer/components/resume-showcase";
import { AppSelect } from "@/components/ui/app-select";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import type { RevealedCandidateResponse } from "@/store/employer/candidates";
import { useShortlistEmployerCandidateMutation } from "@/store/employer/candidates";

import { useLazyGetEmployerJobsQuery } from "@/store/employer/jobs";
import { useCursorLoadMore } from "@/lib/pagination/use-cursor-load-more";

import type { CandidateBand } from "./types";

interface CandidateDetailsDialogProps {
  open: boolean;
  candidate: RevealedCandidateResponse | null;
  isLoading: boolean;
  error?: unknown;
  onRetry: () => void;
  onClose: () => void;
}

const BAND_PRESENTATION: Record<
  CandidateBand,
  { label: string; className: string }
> = {
  ENTRY: {
    label: "Entry",
    className: "bg-[#f0f2f5] text-[#5f6877]",
  },
  DEVELOPING: {
    label: "Developing",
    className: "bg-[#edf2fa] text-[#315c9f]",
  },
  SOLID: {
    label: "Solid",
    className: "bg-[#e8f5ef] text-[#217653]",
  },
  STRONG: {
    label: "Strong",
    className: "bg-[#eeecff] text-[#51449a]",
  },
};

function initialsOf(name: string | null): string {
  if (!name) {
    return "C";
  }

  return (
    name
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "C"
  );
}

export function CandidateDetailsDialog({
  open,
  candidate,
  isLoading,
  error,
  onRetry,
  onClose,
}: CandidateDetailsDialogProps) {
  useScrollLock(open);
  const [shortlistCandidate, shortlistState] = useShortlistEmployerCandidateMutation();
  const [confirmShortlist, setConfirmShortlist] = useState(false);
  const [selection, setSelection] = useState({ candidateId: "", jobId: "", jobTitle: "" });
  const jobId = selection.candidateId === candidate?.candidate_id ? selection.jobId : "";
  const [sentInvitations, setSentInvitations] = useState<Record<string, string>>({});
  const [jobSearch, setJobSearch] = useState("");
  const debouncedJobSearch = useDebouncedSearch(jobSearch);
  const [loadJobs] = useLazyGetEmployerJobsQuery();
  const jobs = useCursorLoadMore(useCallback((cursor: string | undefined) =>
    loadJobs({ status: "PUBLISHED", q: debouncedJobSearch || undefined, cursor, limit: 20 }).unwrap(),
    [loadJobs, debouncedJobSearch]), [debouncedJobSearch], open);
  const jobOptions = jobs.items.map((job) => ({ value: job.id, label: job.title }));
  if (jobId && !jobOptions.some((option) => option.value === jobId)) {
    jobOptions.unshift({ value: jobId, label: selection.jobTitle });
  }
  const [isExpanded, setIsExpanded] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return;
    const timer = window.setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);
  const invitationKey = `${candidate?.candidate_id}:${jobId}`;
  const invitationStatus = sentInvitations[invitationKey] ?? candidate?.shortlist?.invitations.find((item) => item.job_id === jobId)?.status;
  const alreadyInvited = Boolean(invitationStatus && invitationStatus !== "CANCELLED");
  const shortlistError = shortlistState.originalArgs?.candidate_id === candidate?.candidate_id
    ? shortlistState.error : undefined;

  async function handleShortlist() {
    if (!candidate || !jobId || alreadyInvited || shortlistState.isLoading) return;
    try {
      const result = await shortlistCandidate({ candidate_id: candidate.candidate_id, job_id: jobId }).unwrap();
      setSentInvitations((previous) => ({ ...previous, [invitationKey]: result.status }));
    } catch {
      // Keep the selection available for retry; render the API error below.
    }
  }

  async function confirmShortlistInvitation() {
    setConfirmShortlist(false);
    await handleShortlist();
  }

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  const displayName = candidate?.full_name ?? "Candidate profile";
  const location =
    [candidate?.city, candidate?.state_code].filter(Boolean).join(" · ") ||
    "Location not shared";

  return (
    <div data-scroll-lock-root className="fixed inset-0 z-[100]">
      <button
        type="button"
        aria-label="Close candidate profile"
        onClick={onClose}
        className="bp-drawer-backdrop absolute inset-0 cursor-default bg-[#172033]/30"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="candidate-profile-title"
        aria-busy={isLoading}
        className={`bp-drawer-right absolute inset-y-0 right-0 flex h-full ${
          isExpanded ? "w-[860px]" : "w-[540px]"
        } max-w-full flex-col bg-white shadow-[-20px_0_60px_-24px_rgba(0,0,0,0.5)] transition-[width] duration-200`}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#e8ebf0] px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#eeecff] text-[13px] font-bold text-[#51449a]">
              {candidate ? initialsOf(candidate.full_name) : "C"}
            </div>
            <div className="min-w-0">
              <h2
                id="candidate-profile-title"
                className="truncate text-[18px] font-bold text-[#172033]"
              >
                {isLoading ? "Opening candidate profile" : displayName}
              </h2>
              <p className="mt-0.5 truncate text-[11px] text-[#7b8494]">
                {candidate
                  ? `Candidate ${candidate.candidate_id.slice(0, 8)}`
                  : "Retrieving the latest profile details"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setIsExpanded((prev) => !prev)}
              aria-label={isExpanded ? "Standard width" : "Expand drawer"}
              title={isExpanded ? "Collapse drawer width" : "Expand drawer width"}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#687182] transition-colors hover:bg-[#f1f3f6] hover:text-[#172033]"
            >
              {isExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
            <button
              type="button"
              autoFocus
              onClick={onClose}
              aria-label="Close candidate profile"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#687182] transition-colors hover:bg-[#f1f3f6] hover:text-[#172033]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>

        <div className="bp-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {isLoading ? <CandidateProfileSkeleton /> : null}

          {!isLoading && error ? (
            <EmployerErrorState
              error={error}
              fallback="This candidate profile could not be opened."
              title="Unable to open profile"
              variant="block"
              onRetry={onRetry}
            />
          ) : null}

          {!isLoading && !error && candidate ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-[1.2fr_0.8fr]">
                <section className="rounded-xl border border-[#e5e8ee] bg-[#f9fafb] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#7b8494]">
                    Profile summary
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${BAND_PRESENTATION[candidate.band].className}`}
                    >
                      {BAND_PRESENTATION[candidate.band].label} band
                    </span>
                    <span className="text-[12px] text-[#687182]">
                      {candidate.experience_years}{" "}
                      {candidate.experience_years === 1 ? "year" : "years"} of
                      experience
                    </span>
                  </div>
                  <div className="mt-4 flex items-center gap-2 text-[13px] text-[#43516a]">
                    <MapPin className="h-4 w-4 shrink-0 text-[#6f7c91]" />
                    <span>{location}</span>
                  </div>
                </section>

                <section className="rounded-xl border border-[#dce5f3] bg-[#f3f7fc] p-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#62718a]">
                    BharatPath score
                  </p>
                  <p className="mt-2 text-[30px] font-bold leading-none text-[#28578f]">
                    {candidate.score}
                  </p>
                  <p className="mt-2 text-[11px] leading-4 text-[#718096]">
                    Display score from the candidate&apos;s current profile
                  </p>
                </section>
              </div>

              <section>
                <SectionHeading
                  icon={UserRound}
                  title="Contact information"
                />
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <ContactItem
                    icon={Mail}
                    label="Email"
                    value={candidate.email}
                    href={
                      candidate.email ? `mailto:${candidate.email}` : undefined
                    }
                  />
                  <ContactItem
                    icon={Phone}
                    label="Phone"
                    value={candidate.phone}
                    href={
                      candidate.phone ? `tel:${candidate.phone}` : undefined
                    }
                  />
                </div>
              </section>

              <section>
                <SectionHeading
                  icon={BriefcaseBusiness}
                  title="Skills"
                />
                {candidate.skills.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {candidate.skills.map((skill) => (
                      <span
                        key={skill}
                        className="rounded-full border border-[#e3e7ed] bg-[#f5f7f9] px-3 py-1.5 text-[12px] font-medium text-[#344054]"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                ) : (
                  <EmptyDetail text="No skills were provided." />
                )}
              </section>

              <section>
                <SectionHeading icon={FileText} title="Resume" />
                <ResumeShowcase
                  resume={candidate.resume}
                  currentTime={currentTime}
                  onRefresh={onRetry}
                />
              </section>
            </div>
          ) : null}
        </div>

        <footer className="shrink-0 space-y-3 border-t border-[#e8ebf0] bg-[#fafbfc] px-5 py-3">
          {!isLoading && !error && candidate ? (
            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-[#273142]">Shortlist for a job</p>
              <AppSelect
                value={jobId}
                onChange={(value) => setSelection({ candidateId: candidate.candidate_id, jobId: value, jobTitle: jobOptions.find((option) => option.value === value)?.label ?? "Selected job" })}
                options={jobOptions}
                placeholder="Select a published job"
                ariaLabel="Shortlist for a job"
                searchable
                searchPlaceholder="Search published jobs"
                onSearchChange={setJobSearch}
                isSearching={jobs.isLoading || jobSearch.trim() !== debouncedJobSearch}
                loadingMessage={jobSearch ? "Searching jobs..." : "Loading jobs..."}
                noOptionsMessage={jobSearch ? "No published jobs match your search" : "No published jobs available"}
                hasMoreOptions={jobs.hasMore}
                onLoadMoreOptions={jobs.loadMore}
                isLoadingMoreOptions={jobs.isLoadingMore}
                menuPlacement="top"
                portal
                menuClassName="!z-[110]"
              />
              {jobs.error ? <EmployerErrorState error={jobs.error} onRetry={jobs.retry} /> : null}
              {shortlistError ? <EmployerErrorState error={shortlistError} fallback="This invitation could not be sent. Please try again." /> : null}
              <p className="text-[12px] text-[#687182]">The candidate enters Shortlisted after accepting your invitation.</p>
              {alreadyInvited ? <p role="status" className="text-[12px] font-medium text-[#51449a]">{invitationStatus === "DECLINED" ? "Invitation rejected for this job." : invitationStatus === "ACCEPTED" ? "Invitation accepted." : "Invitation sent. Awaiting candidate response."}</p> : null}
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setConfirmShortlist(true)}
            disabled={!candidate || isLoading || Boolean(error) || shortlistState.isLoading || !jobId || alreadyInvited}
            className="rounded-lg bg-[#5b4fcf] px-4 py-2 text-[12px] font-semibold text-white transition-colors hover:bg-[#51449a] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {shortlistState.isLoading ? "Sending..." : invitationStatus === "DECLINED" ? "Invitation rejected" : invitationStatus === "ACCEPTED" ? "Shortlisted" : alreadyInvited ? "Invited" : "Shortlist & invite"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d9dee7] bg-white px-4 py-2 text-[12px] font-semibold text-[#344054] transition-colors hover:bg-[#f5f6f8]"
          >
            Close
          </button>
          </div>
        </footer>
      </aside>
      {confirmShortlist && candidate && jobId && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-[rgba(23,32,51,0.48)] p-4 backdrop-blur-[2px]" role="presentation">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="shortlist-confirm-title"
            className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-[#e8ebf0] bg-white shadow-[0_24px_70px_-20px_rgba(15,23,42,0.38)]"
          >
            <div className="p-6 pb-5">
              <div className="flex items-start gap-3.5">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#eeecff] text-[13px] font-bold text-[#51449a]">
                  {initialsOf(candidate.full_name)}
                </div>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#7b8494]">Invitation confirmation</p>
                  <h2 id="shortlist-confirm-title" className="mt-1 text-[17px] font-bold tracking-[-0.02em] text-[#172033]">Send shortlist invitation?</h2>
                </div>
              </div>
              <p className="mt-5 text-[13px] leading-5 text-[#687182]">You’re inviting <span className="font-semibold text-[#273142]">{displayName}</span> to apply for this role.</p>
              <div className="mt-3 flex items-center gap-3 rounded-xl border border-[#e8ebf0] bg-[#f8f9fb] px-3.5 py-3">
                <BriefcaseBusiness className="h-4 w-4 shrink-0 text-[#51449a]" />
                <span className="min-w-0 truncate text-[13px] font-semibold text-[#273142]">{jobOptions.find((option) => option.value === jobId)?.label ?? selection.jobTitle}</span>
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-[#edf0f4] bg-[#fafbfc] px-6 py-4">
              <button
                type="button"
                onClick={() => setConfirmShortlist(false)}
                className="rounded-lg border border-[#d9dee7] bg-white px-4 py-2.5 text-[12px] font-semibold text-[#344054] transition-colors hover:bg-[#f5f6f8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4fcf]/30"
              >Cancel</button>
              <button
                type="button"
                onClick={() => void confirmShortlistInvitation()}
                className="rounded-lg bg-[#5b4fcf] px-4 py-2.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#51449a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5b4fcf]/40"
              >Confirm invitation</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function SectionHeading({
  icon: Icon,
  title,
}: {
  icon: typeof UserRound;
  title: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 text-[#66758b]" />
      <h3 className="text-[12px] font-bold uppercase tracking-[0.06em] text-[#566176]">
        {title}
      </h3>
    </div>
  );
}

function ContactItem({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: typeof Mail;
  label: string;
  value: string | null;
  href?: string;
}) {
  const content = (
    <>
      <Icon className="h-4 w-4 shrink-0 text-[#66758b]" />
      <span className="min-w-0">
        <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#8a92a0]">
          {label}
        </span>
        <span className="block truncate text-[12px] font-medium text-[#273142]">
          {value ?? `No ${label.toLowerCase()} shared`}
        </span>
      </span>
    </>
  );

  const className =
    "flex min-w-0 items-center gap-3 rounded-lg border border-[#e5e8ee] bg-white px-3 py-3";

  return href ? (
    <a href={href} className={`${className} hover:border-[#bccbe0]`}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}

function EmptyDetail({ text }: { text: string }) {
  return (
    <p className="mt-3 rounded-lg border border-dashed border-[#dfe4ec] bg-[#fafbfc] px-3 py-3 text-[12px] text-[#7b8494]">
      {text}
    </p>
  );
}

function CandidateProfileSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading candidate profile"
      className="animate-pulse space-y-5"
    >
      <div className="grid gap-3 sm:grid-cols-[1.2fr_0.8fr]">
        <div className="h-32 rounded-xl bg-[#eef1f5]" />
        <div className="h-32 rounded-xl bg-[#edf2f8]" />
      </div>
      <div>
        <div className="h-4 w-36 rounded bg-[#e9edf2]" />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <div className="h-16 rounded-lg bg-[#eef1f5]" />
          <div className="h-16 rounded-lg bg-[#eef1f5]" />
        </div>
      </div>
      <div>
        <div className="h-4 w-20 rounded bg-[#e9edf2]" />
        <div className="mt-3 flex gap-2">
          <div className="h-8 w-24 rounded-full bg-[#eef1f5]" />
          <div className="h-8 w-28 rounded-full bg-[#eef1f5]" />
          <div className="h-8 w-20 rounded-full bg-[#eef1f5]" />
        </div>
      </div>
      <span className="sr-only">Loading candidate profile...</span>
    </div>
  );
}
