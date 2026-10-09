"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  Eye,
  GraduationCap,
  Link2,
  MailOpen,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

import { Skeleton } from "@/components/common/loading";
import { StudentErrorState } from "@/features/student/components";
import { StudentPage, StudentTopBar } from "@/features/student/shell";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { getApiErrorCode, getApiErrorMessage } from "@/lib/api/error-message";
import {
  useAcceptCollegeInvitationMutation,
  useDeclineCollegeInvitationMutation,
  useGetCollegeConsentTermsQuery,
  useGetCollegeInvitationsQuery,
  useGetStudentCollegeLinksQuery,
  useGrantCollegeIndividualVisibilityMutation,
  useLinkStudentCollegeByReferralMutation,
  useRevokeCollegeConsentMutation,
} from "@/store/student";

const day = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

const daysLeft = (iso: string) => Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);

const monogram = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "C";

const primary =
  "inline-flex items-center justify-center gap-2 rounded-full bg-[#5F4DB2] px-5 py-2.5 text-[13px] font-semibold text-white shadow-[0_6px_16px_-6px_rgba(95,77,178,0.7)] transition hover:bg-[#51449a] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none";
const secondary =
  "inline-flex items-center justify-center gap-2 rounded-full border border-[#D9D2C3] bg-white px-4 py-2 text-[13px] font-semibold text-[#3A4761] transition hover:bg-[#F7F4EC] disabled:cursor-not-allowed disabled:opacity-50";
const danger =
  "inline-flex items-center justify-center gap-2 rounded-full border border-red-200 bg-white px-4 py-2 text-[13px] font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

type Pending =
  | { kind: "link"; code: string }
  | { kind: "accept"; invitationId: string; college: string }
  | { kind: "individual"; collegeId: string; college: string };

interface LinkedCollege {
  collegeId: string;
  name: string;
  byName: boolean;
  seatHeld: boolean;
  since: string;
}

/** A hand-rolled dialog shell shared by the consent and disconnect prompts. */
function Dialog({
  labelledBy,
  role = "dialog",
  onClose,
  children,
}: {
  labelledBy: string;
  role?: "dialog" | "alertdialog";
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(19,26,38,0.45)] p-4"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <section
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        className="max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-[28px] bg-white p-6 shadow-2xl"
      >
        {children}
      </section>
    </div>
  );
}

/** One line, dashes added as you type: XXXX-XXXX-XXXX. `value` holds the 12 raw characters. */
function CodeInput({
  value,
  onChange,
  onEnter,
}: {
  value: string;
  onChange: (next: string) => void;
  onEnter: () => void;
}) {
  const shown = [value.slice(0, 4), value.slice(4, 8), value.slice(8, 12)].filter(Boolean).join("-");

  return (
    <input
      value={shown}
      maxLength={14}
      autoComplete="off"
      autoCapitalize="characters"
      spellCheck={false}
      placeholder="XXXX-XXXX-XXXX"
      aria-label="College referral code"
      onChange={(event) => onChange(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12))}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onEnter();
        }
      }}
      className="h-14 w-full rounded-2xl border border-[#D9D2C3] bg-[#FFFCF7] px-4 text-center font-mono text-[20px] font-bold tracking-[0.18em] text-[#2D2466] outline-none transition placeholder:text-[#B9B2A0] focus:border-[#5F4DB2] focus:ring-4 focus:ring-[#5F4DB2]/15"
    />
  );
}

/** Linked → counted → seen by name. A stepped track, never a gauge. */
function VisibilitySteps({ byName }: { byName: boolean }) {
  const steps = [
    { label: "Linked", note: "You and your college are connected", done: true },
    { label: "Counted", note: "In cohort totals, with no name", done: true },
    { label: "Seen by name", note: "Your college can open your profile", done: byName },
  ];
  return (
    <ol className="grid gap-3 sm:grid-cols-3">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-start gap-3">
          <span
            className={[
              "mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-bold",
              step.done ? "bg-[#5F4DB2] text-white" : "border border-dashed border-[#BDB4A0] text-[#8A8472]",
            ].join(" ")}
            aria-hidden="true"
          >
            {step.done ? <Check size={13} strokeWidth={3} /> : index + 1}
          </span>
          <span className="min-w-0">
            <span className={`block text-[13px] font-bold ${step.done ? "text-[#0A1931]" : "text-[#8A8472]"}`}>
              {step.label}
              <span className="sr-only">{step.done ? " (active)" : " (off)"}</span>
            </span>
            <span className="block text-[11.5px] leading-4 text-[#68758A]">{step.note}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

export function CollegePage() {
  const links = useGetStudentCollegeLinksQuery();
  const invitations = useGetCollegeInvitationsQuery();
  const [link] = useLinkStudentCollegeByReferralMutation();
  const [accept] = useAcceptCollegeInvitationMutation();
  const [decline] = useDeclineCollegeInvitationMutation();
  const [grant] = useGrantCollegeIndividualVisibilityMutation();
  const [revoke] = useRevokeCollegeConsentMutation();

  const [code, setCode] = useState("");
  const [pending, setPending] = useState<Pending | null>(null);
  const [disconnecting, setDisconnecting] = useState<LinkedCollege | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scope = pending?.kind === "individual" ? "INDIVIDUAL" : "ROSTER";
  const terms = useGetCollegeConsentTermsQuery(scope, { skip: !pending });

  /** One entry per college: a college can hold a roster and an individual link at once. */
  const colleges = useMemo<LinkedCollege[]>(() => {
    const byCollege = new Map<string, LinkedCollege>();
    for (const item of links.data ?? []) {
      if (item.revokedAt) continue;
      const existing = byCollege.get(item.collegeId);
      byCollege.set(item.collegeId, {
        collegeId: item.collegeId,
        name: existing?.name ?? item.collegeName ?? "College",
        byName: Boolean(existing?.byName) || item.scope === "INDIVIDUAL",
        seatHeld: Boolean(existing?.seatHeld) || item.seatHeld,
        since:
          existing && new Date(existing.since) < new Date(item.grantedAt) ? existing.since : item.grantedAt,
      });
    }
    return [...byCollege.values()];
  }, [links.data]);

  const inviteCount = invitations.data?.length ?? 0;
  const seated = colleges.some((college) => college.seatHeld);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      showSuccessFeedback(done);
      setPending(null);
      setDisconnecting(null);
    } catch (failure) {
      setError(getApiErrorMessage(failure, "That did not go through. Please try again."));
      if (getApiErrorCode(failure) === "consent_version_outdated") void terms.refetch();
    } finally {
      setBusy(false);
    }
  }

  function start(next: Pending) {
    setError(null);
    setPending(next);
  }

  function formatted(raw: string) {
    return [raw.slice(0, 4), raw.slice(4, 8), raw.slice(8, 12)].join("-");
  }

  function submitCode() {
    if (code.length === 12) start({ kind: "link", code: formatted(code) });
  }

  function confirm() {
    if (!pending || !terms.data) return;
    const consentVersion = terms.data.consent_version;
    if (pending.kind === "link") {
      const entered = pending.code;
      void run(async () => {
        await link({ code: entered, consentVersion }).unwrap();
        setCode("");
      }, "College linked.");
    } else if (pending.kind === "accept") {
      void run(() => accept({ id: pending.invitationId, consentVersion }).unwrap(), "Invitation accepted.");
    } else {
      void run(
        () => grant({ collegeId: pending.collegeId, consentVersion }).unwrap(),
        "Your college can now see your profile by name.",
      );
    }
  }

  const title =
    pending?.kind === "link"
      ? "Link this college?"
      : pending?.kind === "accept"
        ? `Accept the invitation from ${pending.college}?`
        : pending
          ? `Let ${pending.college} see you by name?`
          : "";

  return (
    <StudentPage>
      <div className="flex flex-col gap-6 sm:gap-8">
        <StudentTopBar title="College" className="!mb-0" />

        {/* Hero */}
        <header className="relative overflow-hidden rounded-[28px] border border-[#E7E0D4] bg-white px-6 py-7 sm:px-9 sm:py-9">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-[#F3F0FB]"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 right-40 h-48 w-48 rounded-full bg-[#FBF1D6]/70"
          />
          <div className="relative grid gap-7 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-[#F3F0FB] px-3 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-[#5F4DB2]">
                <GraduationCap size={14} aria-hidden="true" /> Campus link
              </span>
              <h1 className="mt-4 text-[30px] font-extrabold leading-[1.08] tracking-[-0.035em] text-[#0A1931] sm:text-[38px]">
                Your college,
                <br />
                <span className="text-[#5F4DB2]">on your terms.</span>
              </h1>
              <p className="mt-3 max-w-[460px] text-[14px] leading-6 text-[#5F6B80]">
                Connect with the code your college gave you, answer their invitations, and decide how much of you they
                can see. You can step back at any time.
              </p>
            </div>
            <dl className="grid grid-cols-3 gap-3">
              {[
                { icon: Link2, label: "Linked", value: colleges.length },
                { icon: MailOpen, label: "Invitations", value: inviteCount },
                { icon: ShieldCheck, label: "College seat", value: seated ? "Yes" : "No" },
              ].map(({ icon: Icon, label, value }) => (
                <div key={label} className="rounded-2xl border border-[#EFE9DC] bg-[#FBF8F1] p-4">
                  <Icon size={16} className="text-[#5F4DB2]" aria-hidden="true" />
                  <dd className="mt-3 text-[26px] font-extrabold leading-none tracking-[-0.03em] text-[#0A1931]">{value}</dd>
                  <dt className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#68758A]">{label}</dt>
                </div>
              ))}
            </dl>
          </div>
        </header>

        {error && !pending && !disconnecting ? (
          <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {/* Disconnect prompt */}
        {disconnecting ? (
          <Dialog labelledBy="college-disconnect-title" role="alertdialog" onClose={() => (busy ? undefined : setDisconnecting(null))}>
            <h2 id="college-disconnect-title" className="text-[18px] font-extrabold tracking-[-0.02em] text-[#0A1931]">
              Disconnect from {disconnecting.name}?
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#3A4761]">
              Your college will stop counting you and can no longer see your details.
              {disconnecting.seatHeld
                ? " Your college seat will be released, so you may lose access unless you have a membership."
                : ""}
            </p>
            {error ? (
              <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" disabled={busy} onClick={() => setDisconnecting(null)} className={secondary}>
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                disabled={busy}
                onClick={() =>
                  void run(
                    () => revoke({ collegeId: disconnecting.collegeId, scope: "ROSTER" }).unwrap(),
                    "You are disconnected from the college.",
                  )
                }
                className="inline-flex items-center justify-center rounded-full bg-red-600 px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? "Working…" : "Disconnect"}
              </button>
            </div>
          </Dialog>
        ) : null}

        {/* Consent prompt */}
        {pending ? (
          <Dialog labelledBy="college-consent-title" onClose={() => (busy ? undefined : setPending(null))}>
            <h2 id="college-consent-title" className="text-[18px] font-extrabold tracking-[-0.02em] text-[#0A1931]">
              {title}
            </h2>
            <p className="mt-1 text-[12px] font-semibold uppercase tracking-[0.1em] text-[#8A8472]">
              Read before you agree
            </p>
            <p className="mt-3 rounded-2xl border border-[#E7E0D4] bg-[#FFFCF7] p-4 text-sm leading-6 text-[#3A4761]">
              {terms.isLoading ? "Loading consent terms…" : (terms.data?.text ?? "The consent terms could not be loaded.")}
            </p>
            {error ? (
              <p role="alert" className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            ) : null}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" disabled={busy} onClick={() => setPending(null)} className={secondary}>
                Cancel
              </button>
              <button type="button" autoFocus disabled={busy || !terms.data} onClick={confirm} className={primary}>
                {busy ? "Working…" : "Agree"}
              </button>
            </div>
          </Dialog>
        ) : null}

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          {/* Linked colleges */}
          <section className="flex min-w-0 flex-col gap-4" aria-labelledby="linked-colleges">
            <h2 id="linked-colleges" className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-[#68758A]">
              <Building2 size={15} aria-hidden="true" /> Linked colleges
            </h2>

            {links.isLoading ? (
              <Skeleton width="100%" height={190} radius={24} />
            ) : links.isError ? (
              <StudentErrorState message="Your colleges could not be loaded." onRetry={() => void links.refetch()} />
            ) : colleges.length === 0 ? (
              <div className="relative overflow-hidden rounded-[28px] border border-dashed border-[#D9D2C3] bg-[#FFFCF7] px-6 py-12 text-center">
                <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-[#F4F1FC] text-[#5F4DB2]">
                  <GraduationCap size={28} aria-hidden="true" />
                </span>
                <p className="mt-4 text-[17px] font-extrabold tracking-[-0.02em] text-[#0A1931]">No college linked yet</p>
                <p className="mx-auto mt-1 max-w-[320px] text-[13px] leading-5 text-[#68758A]">
                  Type the code from your college on the right, or accept an invitation when one arrives.
                </p>
              </div>
            ) : (
              colleges.map((college) => (
                <article
                  key={college.collegeId}
                  className="relative overflow-hidden rounded-[28px] border border-[#E7E0D4] bg-white shadow-[0_18px_40px_-28px_rgba(30,22,80,0.45)]"
                >
                  <div aria-hidden="true" className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-[#5F4DB2] via-[#8172CA] to-[#F4D685]" />
                  <div className="p-5 pl-7 sm:p-6 sm:pl-8">
                    <div className="flex flex-wrap items-center gap-4">
                      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-[#5F4DB2] text-[17px] font-extrabold tracking-wide text-white">
                        {monogram(college.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-[20px] font-extrabold tracking-[-0.025em] text-[#0A1931]">
                          {college.name}
                        </h3>
                        <p className="text-[12px] text-[#68758A]">Linked since {day(college.since)}</p>
                      </div>
                      {college.seatHeld ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF7F1] px-3 py-1.5 text-[11.5px] font-bold text-[#1F6B45]">
                          <Sparkles size={13} aria-hidden="true" /> Seat paid by college
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-6 rounded-2xl bg-[#FBF8F1] p-4">
                      <VisibilitySteps byName={college.byName} />
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-3">
                      {college.byName ? (
                        <button
                          type="button"
                          disabled={busy}
                          className={secondary}
                          onClick={() =>
                            void run(
                              () => revoke({ collegeId: college.collegeId, scope: "INDIVIDUAL" }).unwrap(),
                              "Your college can no longer see you by name.",
                            )
                          }
                        >
                          <Eye size={14} aria-hidden="true" /> Stop sharing by name
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={busy}
                          className={secondary}
                          onClick={() => start({ kind: "individual", collegeId: college.collegeId, college: college.name })}
                        >
                          <Eye size={14} aria-hidden="true" /> Share by name
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={busy}
                        className={`${danger} ml-auto`}
                        onClick={() => {
                          setError(null);
                          setDisconnecting(college);
                        }}
                      >
                        Disconnect
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </section>

          {/* Link + invitations */}
          <div className="flex min-w-0 flex-col gap-6">
            <section aria-labelledby="link-code" className="rounded-[28px] border border-[#E7E0D4] bg-white p-5 sm:p-6">
              <h2 id="link-code" className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-[#68758A]">
                <Link2 size={15} aria-hidden="true" /> Link with a code
              </h2>
              <p className="mt-2 text-[13px] leading-5 text-[#68758A]">
                Your college gives you a 12-character code. Type or paste it below.
              </p>
              <div className="mt-4">
                <CodeInput value={code} onChange={setCode} onEnter={submitCode} />
              </div>
              <button
                type="button"
                disabled={code.length !== 12 || busy}
                onClick={submitCode}
                className={`${primary} mt-5 w-full`}
              >
                Continue <ArrowRight size={15} aria-hidden="true" />
              </button>
            </section>

            <section aria-labelledby="college-invitations" className="rounded-[28px] border border-[#E7E0D4] bg-white p-5 sm:p-6">
              <h2 id="college-invitations" className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.16em] text-[#68758A]">
                <Users size={15} aria-hidden="true" /> Invitations
              </h2>
              {invitations.isLoading ? (
                <Skeleton className="mt-4" width="100%" height={70} radius={16} />
              ) : invitations.isError ? (
                <StudentErrorState message="Invitations could not be loaded." onRetry={() => void invitations.refetch()} />
              ) : inviteCount === 0 ? (
                <p className="mt-3 rounded-2xl bg-[#FBF8F1] px-4 py-5 text-center text-[13px] text-[#68758A]">
                  Nothing waiting. Invitations from your college will appear here.
                </p>
              ) : (
                <ul className="mt-4 flex flex-col gap-3">
                  {(invitations.data ?? []).map((item) => {
                    const left = daysLeft(item.expiresAt);
                    return (
                      <li key={item.id} className="rounded-2xl border border-[#EFE9DC] bg-[#FFFCF7] p-4">
                        <div className="flex items-center gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#F4F1FC] text-[12px] font-extrabold text-[#5F4DB2]">
                            {monogram(item.collegeName)}
                          </span>
                          <div className="min-w-0 flex-1">
                            <strong className="block truncate text-[14px] text-[#0A1931]">{item.collegeName}</strong>
                            <span className="text-[11.5px] text-[#68758A]">
                              Sent {day(item.sentAt)} ·{" "}
                              {left > 0 ? `${left} day${left === 1 ? "" : "s"} left` : "expires today"}
                            </span>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            disabled={busy}
                            className={`${primary} flex-1 !py-2`}
                            onClick={() => start({ kind: "accept", invitationId: item.id, college: item.collegeName })}
                          >
                            Accept
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            className={`${secondary} flex-1`}
                            onClick={() => void run(() => decline(item.id).unwrap(), "Invitation declined.")}
                          >
                            Decline
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </StudentPage>
  );
}
