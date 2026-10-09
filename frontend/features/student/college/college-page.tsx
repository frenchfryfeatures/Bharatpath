"use client";

import { useState } from "react";
import { Building2, GraduationCap } from "lucide-react";

import { Skeleton } from "@/components/common/loading";
import { EmptyState, StudentErrorState } from "@/features/student/components";
import { StudentPage, StudentTopBar } from "@/features/student/shell";
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

const card = "rounded-[24px] border border-[#E7E0D4] bg-white p-5 sm:p-6";
const primary =
  "rounded-full bg-[#5F4DB2] px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-[#51449a] disabled:opacity-50";
const secondary =
  "rounded-full border border-[#D9D2C3] bg-white px-4 py-2 text-[13px] font-semibold text-[#3A4761] transition hover:bg-[#F7F4EC] disabled:opacity-50";

type Pending =
  | { kind: "link"; code: string }
  | { kind: "accept"; invitationId: string; college: string }
  | { kind: "individual"; collegeId: string; college: string };

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const scope = pending?.kind === "individual" ? "INDIVIDUAL" : "ROSTER";
  const terms = useGetCollegeConsentTermsQuery(scope, { skip: !pending });

  const active = (links.data ?? []).filter((item) => !item.revokedAt);

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(done);
      setPending(null);
    } catch (failure) {
      setError(getApiErrorMessage(failure, "That did not go through. Please try again."));
      if (getApiErrorCode(failure) === "consent_version_outdated") void terms.refetch();
    } finally {
      setBusy(false);
    }
  }

  function start(next: Pending) {
    setError(null);
    setNotice(null);
    setPending(next);
  }

  function confirm() {
    if (!pending || !terms.data) return;
    const consentVersion = terms.data.consent_version;
    if (pending.kind === "link") {
      const entered = pending.code.trim();
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
      <div className="flex flex-col gap-5 sm:gap-7">
        <StudentTopBar title="College" className="!mb-0" />
        <header className={card}>
          <h1 className="text-2xl font-extrabold tracking-[-0.03em] text-[#0A1931] sm:text-3xl">Your college</h1>
          <p className="mt-1 text-[14px] leading-6 text-[#5F6B80]">
            Link with a code from your college, answer invitations, and choose what your college can see. You can
            disconnect at any time.
          </p>
        </header>

        {notice ? (
          <p role="status" className="rounded-xl border border-[#B8D9C8] bg-[#EEF7F1] p-3 text-sm text-[#174C33]">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {pending ? (
          <section className={card} aria-live="polite">
            <h2 className="text-[15px] font-bold text-[#0A1931]">{title}</h2>
            <p className="mt-3 rounded-2xl border border-[#E7E0D4] bg-[#FFFCF7] p-4 text-sm leading-6 text-[#3A4761]">
              {terms.isLoading ? "Loading consent terms…" : (terms.data?.text ?? "The consent terms could not be loaded.")}
            </p>
            <div className="mt-4 flex gap-3">
              <button type="button" disabled={busy || !terms.data} onClick={confirm} className={primary}>
                {busy ? "Working…" : "Agree"}
              </button>
              <button type="button" disabled={busy} onClick={() => setPending(null)} className={secondary}>
                Cancel
              </button>
            </div>
          </section>
        ) : null}

        <section className={card}>
          <h2 className="text-[15px] font-bold text-[#0A1931]">Link a college with a code</h2>
          <form
            className="mt-3 flex flex-wrap gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (code.trim()) start({ kind: "link", code });
            }}
          >
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="XXXX-XXXX-XXXX"
              aria-label="College referral code"
              className="min-w-0 flex-1 rounded-xl border border-[#D9D2C3] px-3 py-2 font-mono text-sm uppercase"
            />
            <button type="submit" disabled={!code.trim() || busy} className={primary}>
              Continue
            </button>
          </form>
        </section>

        <section className={card}>
          <h2 className="text-[15px] font-bold text-[#0A1931]">Invitations</h2>
          {invitations.isLoading ? (
            <Skeleton className="mt-3" width="100%" height={48} radius={10} />
          ) : invitations.isError ? (
            <StudentErrorState message="Invitations could not be loaded." onRetry={() => void invitations.refetch()} />
          ) : (invitations.data ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-[#5F6B80]">No invitations right now.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {(invitations.data ?? []).map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#FBF8F1] p-4">
                  <Building2 size={18} aria-hidden="true" className="text-[#5F4DB2]" />
                  <div className="min-w-0 flex-1">
                    <strong className="block text-sm text-[#0A1931]">{item.collegeName}</strong>
                    <span className="text-xs text-[#5F6B80]">
                      Sent {day(item.sentAt)} · expires {day(item.expiresAt)}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={busy}
                    className={primary}
                    onClick={() => start({ kind: "accept", invitationId: item.id, college: item.collegeName })}
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    className={secondary}
                    onClick={() => void run(() => decline(item.id).unwrap(), "Invitation declined.")}
                  >
                    Decline
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={card}>
          <h2 className="text-[15px] font-bold text-[#0A1931]">Linked colleges</h2>
          {links.isLoading ? (
            <Skeleton className="mt-3" width="100%" height={48} radius={10} />
          ) : links.isError ? (
            <StudentErrorState message="Your colleges could not be loaded." onRetry={() => void links.refetch()} />
          ) : active.length === 0 ? (
            <EmptyState
              icon={<GraduationCap size={20} />}
              title="No linked college"
              message="Enter a code above or accept an invitation to link one."
            />
          ) : (
            <ul className="mt-3 flex flex-col gap-3">
              {active.map((item) => {
                const name = item.collegeName ?? "College";
                return (
                  <li key={item.collegeId} className="flex flex-wrap items-center gap-3 rounded-2xl bg-[#FBF8F1] p-4">
                    <div className="min-w-0 flex-1">
                      <strong className="block text-sm text-[#0A1931]">{name}</strong>
                      <span className="text-xs text-[#5F6B80]">
                        Linked {day(item.grantedAt)} ·{" "}
                        {item.scope === "INDIVIDUAL"
                          ? "Your college can see your profile by name"
                          : "Counted in your college's totals only"}
                        {item.seatHeld ? " · Your college pays for your access" : ""}
                      </span>
                    </div>
                    {item.scope === "ROSTER" ? (
                      <button
                        type="button"
                        disabled={busy}
                        className={secondary}
                        onClick={() => start({ kind: "individual", collegeId: item.collegeId, college: name })}
                      >
                        Share by name
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        className={secondary}
                        onClick={() =>
                          void run(
                            () => revoke({ collegeId: item.collegeId, scope: "INDIVIDUAL" }).unwrap(),
                            "Your college can no longer see you by name.",
                          )
                        }
                      >
                        Stop sharing by name
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded-full border border-red-200 px-4 py-2 text-[13px] font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-50"
                      onClick={() => {
                        const seat = item.seatHeld ? " Your college seat will be released." : "";
                        if (window.confirm(`Disconnect from ${name}?${seat} Your college will stop counting you.`)) {
                          void run(
                            () => revoke({ collegeId: item.collegeId, scope: "ROSTER" }).unwrap(),
                            "You are disconnected from the college.",
                          );
                        }
                      }}
                    >
                      Disconnect
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </StudentPage>
  );
}
