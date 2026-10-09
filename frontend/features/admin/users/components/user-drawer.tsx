"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { DetailSkeleton } from "@/components/common/loading";
import { ErrorState } from "@/components/ui";
import { useScrollLock } from "@/hooks/use-scroll-lock";
import { showAdminFeedback } from "@/store/admin";
import { useAppDispatch } from "@/store/hooks";
import {
  useAllocateAdminCollegeSeatsMutation,
  useGetAdminCandidateQuery,
  useGetAdminCollegeQuery,
  useGetAdminEmployerQuery,
  useReinstateAdminTenantMutation,
  useSuspendAdminTenantMutation,
  type CandidateDrilldown,
  type CollegeDrilldown,
} from "@/store/api/admin-api";

import { useUsers } from "../hooks/use-users";
import { FieldError, a11y, validateRequiredText } from "../../shared/form";

export function UserDrawer() {
  const dispatch = useAppDispatch();
  const { segment, selectedId, closeUser } = useUsers();
  useScrollLock(Boolean(selectedId));
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const isCandidate = segment === "candidates";
  const isEmployer = segment === "employers";
  const candidateQuery = useGetAdminCandidateQuery(selectedId ?? "", {
    skip: !selectedId || !isCandidate,
  });
  const employerQuery = useGetAdminEmployerQuery(selectedId ?? "", {
    skip: !selectedId || !isEmployer,
  });
  const collegeQuery = useGetAdminCollegeQuery(selectedId ?? "", {
    skip: !selectedId || segment !== "institutions",
  });
  const [suspendTenant, suspendState] = useSuspendAdminTenantMutation();
  const [reinstateTenant, reinstateState] = useReinstateAdminTenantMutation();
  const [allocateSeats, seatState] = useAllocateAdminCollegeSeatsMutation();

  if (!selectedId) return null;

  const organisationDetail = isEmployer ? employerQuery.data : collegeQuery.data;
  const detail = isCandidate ? candidateQuery.data : organisationDetail;
  const isLoading =
    candidateQuery.isLoading ||
    employerQuery.isLoading ||
    collegeQuery.isLoading;
  const error =
    candidateQuery.error ||
    employerQuery.error ||
    collegeQuery.error ||
    suspendState.error ||
    reinstateState.error ||
    seatState.error;
  const isActing = suspendState.isLoading || reinstateState.isLoading || seatState.isLoading;
  const status = detail?.status;
  const title = isCandidate
    ? candidateQuery.data?.full_name ?? "Candidate details"
    : organisationDetail?.name ?? "Organisation details";
  const subjectType = isCandidate
    ? "Candidate"
    : isEmployer
      ? "Employer"
      : "College";

  const updateStatus = async () => {
    try {
      if (status === "SUSPENDED") {
        await reinstateTenant(selectedId).unwrap();
        dispatch(showAdminFeedback("Organisation reinstated."));
      } else {
        // Kept on the suspension row for whoever lifts it; the backend takes 3-500 characters.
        const problem = validateRequiredText(reason, "the reason for suspending", 3, 500);
        if (problem) {
          setReasonError(problem);
          return;
        }
        setReasonError(undefined);
        await suspendTenant({ tenantId: selectedId, reason: reason.trim() }).unwrap();
        dispatch(showAdminFeedback("Organisation suspended."));
        setReason("");
      }
    } catch {
      // Surfaced to the operator through `error` below.
    }
  };

  const saveSeats = async (seats: number) => {
    try {
      await allocateSeats({ tenantId: selectedId, seats }).unwrap();
      dispatch(showAdminFeedback("Seat allocation updated."));
    } catch {
      // Surfaced to the operator through `error` below.
    }
  };

  return (
    <div data-scroll-lock-root className="fixed inset-0 z-[100]">
      <button type="button" aria-label="Close details" onClick={closeUser} className="absolute inset-0 bg-[#172033]/30" />
      <aside className="absolute right-0 top-0 flex h-full w-[520px] max-w-full flex-col bg-white shadow-[-20px_0_60px_-24px_rgba(0,0,0,0.5)]" role="dialog" aria-modal="true">
        <header className="flex items-start justify-between border-b border-[#e5e7eb] px-5 py-4">
          <div>
            <h2 className="text-[18px] font-bold text-[#172033]">{title}</h2>
            <p className="mt-1 text-[12px] text-[#7b8494]">{subjectType} · {selectedId}</p>
          </div>
          <button type="button" onClick={closeUser} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-[#7b8494] hover:bg-[#f5f6f8]"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {isLoading ? (
            <DetailSkeleton
              sections={isCandidate ? 4 : isEmployer ? 3 : 7}
            />
          ) : null}
          {error ? <ErrorState error={error} fallback="The user details or action could not be completed." className="mb-4" /> : null}
          {detail ? (
            <div className="space-y-5 text-[13px]">
              <section className="grid grid-cols-2 gap-3 rounded-lg border border-[#e5e7eb] p-4">
                <Detail label="Status" value={humanise(detail.status)} />
                <Detail label="Created" value={formatDate(detail.created_at)} />
                <Detail
                  label="Subscription"
                  value={
                    detail.subscription
                      ? humanise(detail.subscription.state)
                      : "None"
                  }
                />
                <Detail
                  label="Plan"
                  value={
                    detail.subscription
                      ? humanise(detail.subscription.plan_code)
                      : "None"
                  }
                />
              </section>

              {isCandidate && candidateQuery.data ? (
                <CandidateDetails candidate={candidateQuery.data} />
              ) : null}

              {isEmployer && employerQuery.data ? (
                <section className="grid grid-cols-2 gap-3 rounded-lg border border-[#e5e7eb] p-4">
                  <Detail label="Legal name" value={employerQuery.data.legal_name ?? "Not provided"} />
                  <Detail label="KYB status" value={employerQuery.data.kyb_status ?? "Not submitted"} />
                  <Detail label="Industry" value={employerQuery.data.industry ?? "Not provided"} />
                  <Detail label="Views, last 30 days" value={String(employerQuery.data.candidates_viewed_last_30_days)} />
                </section>
              ) : null}

              {!isEmployer && collegeQuery.data ? (
                <CollegeDetails
                  key={collegeQuery.data.tenant_id}
                  college={collegeQuery.data}
                  isSavingSeats={seatState.isLoading}
                  isBusy={isActing}
                  onSaveSeats={saveSeats}
                />
              ) : null}

              {!isCandidate && status !== "SUSPENDED" ? (
                <div>
                  <label htmlFor="suspension-reason" className="block text-[12px] font-semibold text-[#172033]">Suspension reason</label>
                  <textarea
                    {...a11y("suspension-reason", reasonError)}
                    value={reason}
                    onChange={(event) => { setReason(event.target.value); setReasonError(undefined); }}
                    rows={3}
                    className={`mt-2 w-full rounded-lg border px-3 py-2 text-[13px] font-normal text-[#172033] outline-none ${reasonError ? "border-[#d92d20] focus:border-[#d92d20]" : "border-[#e5e7eb] focus:border-[#315c9f]"}`}
                    placeholder="Required, 3 to 500 characters"
                  />
                  <FieldError id="suspension-reason-error" message={reasonError} />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {organisationDetail ? (
          <footer className="border-t border-[#e5e7eb] p-4">
            <button type="button" disabled={isActing} onClick={() => void updateStatus()} className="w-full rounded-lg border border-[#c92f3f] px-4 py-3 text-[13px] font-semibold text-[#c92f3f] disabled:cursor-not-allowed disabled:opacity-50">
              {isActing ? "Saving..." : status === "SUSPENDED" ? "Reinstate organisation" : "Suspend organisation"}
            </button>
          </footer>
        ) : null}
      </aside>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-[11px] uppercase text-[#7b8494]">{label}</p><p className="mt-1 break-words font-semibold text-[#172033]">{value}</p></div>;
}

function CandidateDetails({
  candidate,
}: {
  candidate: CandidateDrilldown;
}) {
  const location =
    [candidate.city, candidate.state_code].filter(Boolean).join(", ") ||
    "Not provided";

  return (
    <>
      <section className="grid grid-cols-2 gap-3 rounded-lg border border-[#e5e7eb] p-4">
        <Detail label="Full name" value={candidate.full_name ?? "Not provided"} />
        <Detail label="Location" value={location} />
        <Detail label="Email" value={candidate.email_masked ?? "Not provided"} />
        <Detail label="Phone" value={candidate.phone_masked ?? "Not provided"} />
        <Detail label="Locale" value={candidate.locale} />
        <Detail
          label="Employer visibility"
          value={candidate.visible_to_employers ? "Visible" : "Held back"}
        />
      </section>

      <section className="grid grid-cols-2 gap-3 rounded-lg border border-[#e5e7eb] p-4">
        <Detail
          label="Score"
          value={
            candidate.score
              ? `${candidate.score.display_value} · ${candidate.score.band}`
              : "Not scored"
          }
        />
        <Detail
          label="Scores computed"
          value={String(candidate.score?.scores_computed ?? 0)}
        />
        <Detail label="Resume files" value={String(candidate.resume.files)} />
        <Detail label="Resume versions" value={String(candidate.resume.versions)} />
        <Detail
          label="Last confirmed"
          value={
            candidate.resume.last_confirmed_at
              ? formatDate(candidate.resume.last_confirmed_at)
              : "Not confirmed"
          }
        />
        <Detail
          label="College seat"
          value={candidate.seat_held ? "Active" : "None"}
        />
      </section>

      <CountSection
        title="Applications by stage"
        values={candidate.applications_by_stage}
        emptyMessage="No applications"
      />

      <section className="rounded-lg border border-[#e5e7eb] p-4">
        <h3 className="text-[12px] font-semibold text-[#172033]">
          Integrity signals
        </h3>
        {candidate.integrity_signals.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {candidate.integrity_signals.map((signal) => (
              <span
                key={`${signal.severity}-${signal.state}`}
                className="rounded-full bg-[#f4f6f8] px-2.5 py-1 text-[11px] font-semibold text-[#526074]"
              >
                {humanise(signal.severity)} · {humanise(signal.state)} ·{" "}
                {signal.count}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-[#7b8494]">
            No integrity signals
          </p>
        )}
      </section>

      <section className="rounded-lg border border-[#e5e7eb] p-4">
        <h3 className="text-[12px] font-semibold text-[#172033]">
          College links
        </h3>
        {candidate.college_links.length > 0 ? (
          <div className="mt-3 space-y-2">
            {candidate.college_links.map((link) => (
              <div
                key={`${link.tenant_id}-${link.scope}`}
                className="flex items-center justify-between gap-3 rounded-lg bg-[#f7f8fa] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[#172033]">
                    {link.college}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#7b8494]">
                    Granted {formatDate(link.granted_at)}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-[#eef0ff] px-2 py-1 text-[10px] font-bold text-[#4e43b7]">
                  {humanise(link.scope)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-[12px] text-[#7b8494]">No college links</p>
        )}
      </section>

      <CountSection
        title="Disputes by state"
        values={candidate.disputes_by_state}
        emptyMessage="No disputes"
      />
    </>
  );
}

function CollegeDetails({
  college,
  isSavingSeats,
  isBusy,
  onSaveSeats,
}: {
  college: CollegeDrilldown;
  isSavingSeats: boolean;
  isBusy: boolean;
  onSaveSeats: (seats: number) => Promise<void>;
}) {
  const usedSeats = college.seats?.used ?? 0;
  const allocatedSeats = college.seats?.allocated ?? 0;
  const planAllowance = college.seats?.plan_allowance ?? null;
  const availableSeats = Math.max(allocatedSeats - usedSeats, 0);
  const seatUsage =
    allocatedSeats > 0
      ? Math.min((usedSeats / allocatedSeats) * 100, 100)
      : 0;
  const [seatDraft, setSeatDraft] = useState(String(allocatedSeats));
  const requestedSeats = Number(seatDraft);
  const seatError =
    seatDraft.trim() === "" || !Number.isInteger(requestedSeats)
      ? "Enter a whole number of seats."
      : requestedSeats < usedSeats
        ? `Allocation cannot be below ${formatCount(usedSeats)} seats currently in use.`
        : planAllowance !== null && requestedSeats > planAllowance
          ? `This plan allows up to ${formatCount(planAllowance)} seats.`
          : null;
  const allocationChanged =
    seatError === null && requestedSeats !== allocatedSeats;

  return (
    <>
      <section className="rounded-lg border border-[#e5e7eb] p-4">
        <SectionHeading
          title="Institution"
          description="Profile and verification details"
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Detail
            label="Institution type"
            value={
              college.institution_type
                ? humanise(college.institution_type)
                : "Not provided"
            }
          />
          <Detail
            label="Verified"
            value={
              college.verified_at
                ? formatDate(college.verified_at)
                : "Not verified"
            }
          />
          <Detail
            label="Onboarding submitted"
            value={
              college.onboarding_submitted_at
                ? formatDate(college.onboarding_submitted_at)
                : "Not submitted"
            }
          />
          <Detail
            label="Subscription ends"
            value={
              college.subscription?.current_period_end
                ? formatDate(college.subscription.current_period_end)
                : "No active period"
            }
          />
        </div>
      </section>

      <section className="rounded-lg border border-[#e5e7eb] p-4">
        <SectionHeading
          title="Students and seats"
          description="Current consent and seat usage"
        />

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Metric
            label="Connected"
            value={college.connected_students}
            description="Roster-visible students"
          />
          <Metric
            label="Individually visible"
            value={college.individually_visible}
            description="Visible by name"
          />
          <Metric
            label="Seats used"
            value={usedSeats}
            description={`${formatCount(availableSeats)} remaining`}
          />
          <Metric
            label="Plan allowance"
            value={planAllowance}
            description={
              planAllowance === null
                ? "No plan limit available"
                : "Maximum allocation"
            }
          />
        </div>

        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="font-semibold text-[#526074]">Seat usage</span>
            <span className="text-[#7b8494]">
              {formatCount(usedSeats)} of {formatCount(allocatedSeats)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-[#eef0f3]">
            <div
              className="h-full rounded-full bg-[#315c9f] transition-[width]"
              style={{ width: `${seatUsage}%` }}
            />
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-[#f7f8fa] p-3">
          <label
            htmlFor="college-seat-allocation"
            className="block text-[12px] font-semibold text-[#172033]"
          >
            Allocated seats
          </label>
          <div className="mt-2 flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <input
                id="college-seat-allocation"
                type="number"
                min={usedSeats}
                max={planAllowance ?? undefined}
                step={1}
                value={seatDraft}
                aria-invalid={seatError !== null}
                aria-describedby="college-seat-allocation-help"
                onChange={(event) => setSeatDraft(event.target.value)}
                className="w-full rounded-lg border border-[#dfe3e9] bg-white px-3 py-2 text-[13px] font-semibold text-[#172033] outline-none focus:border-[#315c9f] focus:ring-2 focus:ring-[#315c9f]/10"
              />
              <p
                id="college-seat-allocation-help"
                className={`mt-1.5 text-[11px] ${
                  seatError ? "text-[#c92f3f]" : "text-[#7b8494]"
                }`}
              >
                {seatError ??
                  (planAllowance === null
                    ? `At least ${formatCount(usedSeats)} seats are required.`
                    : `${formatCount(usedSeats)} currently used · ${formatCount(planAllowance)} allowed by the plan`)}
              </p>
            </div>
            <button
              type="button"
              disabled={isBusy || !allocationChanged}
              onClick={() => void onSaveSeats(requestedSeats)}
              className="shrink-0 rounded-lg bg-[#315c9f] px-3 py-2 text-[12px] font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSavingSeats ? "Saving..." : "Update seats"}
            </button>
          </div>
        </div>
      </section>

      <CountSection
        title="Team members"
        values={college.members_by_role}
        emptyMessage="No active team members"
      />

      <section className="rounded-lg border border-[#e5e7eb] p-4">
        <SectionHeading
          title="Student linking"
          description="Referral and roster activity"
        />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Detail
            label="Live referral codes"
            value={formatCount(college.live_referral_codes)}
          />
          <Detail
            label="Roster imports"
            value={formatCount(
              totalCounts(college.roster_imports_by_state),
            )}
          />
        </div>
      </section>

      <CountSection
        title="Roster imports by state"
        values={college.roster_imports_by_state}
        emptyMessage="No roster imports"
      />

      <CountSection
        title="Invitations by state"
        values={college.invitations_by_state}
        emptyMessage="No invitations"
      />

      <CountSection
        title="Disputes by state"
        values={college.disputes_by_state}
        emptyMessage="No disputes"
      />

      <section className="rounded-lg border border-[#e5e7eb] p-4">
        <SectionHeading title="Suspension" />
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Detail
            label="State"
            value={college.suspension ? "Suspended" : "Not suspended"}
          />
          <Detail
            label="Since"
            value={
              college.suspension
                ? formatDate(college.suspension.suspended_at)
                : "-"
            }
          />
        </div>
      </section>
    </>
  );
}

function CountSection({
  title,
  values,
  emptyMessage,
}: {
  title: string;
  values: Record<string, number>;
  emptyMessage: string;
}) {
  const entries = Object.entries(values).filter(([, count]) => count > 0);

  return (
    <section className="rounded-lg border border-[#e5e7eb] p-4">
      <h3 className="text-[12px] font-semibold text-[#172033]">{title}</h3>
      {entries.length > 0 ? (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {entries.map(([label, count]) => (
            <Detail key={label} label={humanise(label)} value={String(count)} />
          ))}
        </div>
      ) : (
        <p className="mt-2 text-[12px] text-[#7b8494]">{emptyMessage}</p>
      )}
    </section>
  );
}

function SectionHeading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div>
      <h3 className="text-[12px] font-semibold text-[#172033]">{title}</h3>
      {description ? (
        <p className="mt-0.5 text-[11px] text-[#7b8494]">{description}</p>
      ) : null}
    </div>
  );
}

function Metric({
  label,
  value,
  description,
}: {
  label: string;
  value: number | null;
  description: string;
}) {
  return (
    <div className="rounded-lg bg-[#f7f8fa] p-3">
      <p className="text-[11px] font-medium text-[#7b8494]">{label}</p>
      <p className="mt-1 text-[20px] font-bold text-[#172033]">
        {value === null ? "-" : formatCount(value)}
      </p>
      <p className="mt-0.5 text-[10px] leading-4 text-[#7b8494]">
        {description}
      </p>
    </div>
  );
}

function totalCounts(values: Record<string, number>): number {
  return Object.values(values).reduce((total, count) => total + count, 0);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

function humanise(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unavailable"
    : date.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
}
