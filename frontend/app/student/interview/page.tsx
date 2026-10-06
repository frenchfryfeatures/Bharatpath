"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Clock3,
  HardDrive,
  Headphones,
  Mic2,
  Play,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Wifi,
} from "lucide-react";
import { useState } from "react";

import { StudentAudioPlayer, StudentErrorState } from "@/features/student/components";
import { StudentPage } from "@/features/student/shell";
import { useSimulatePaymentMutation } from "@/store/api/payment.api";
import { useGetInterviewOfferQuery } from "@/store/student";
import {
  useCheckoutInterviewMutation,
  useCheckInterviewDeviceMutation,
  useGetInterviewHistoryQuery,
  useGetInterviewRecordingsQuery,
  useGetInterviewReportQuery,
  useStartInterviewMutation,
} from "@/store/student/learning.api";

const DEVICE_FAILURES: Record<string, string> = {
  microphone_unavailable: "Microphone access was not available.",
  audio_output_unavailable: "Confirm that you can hear audio on this device.",
  network_too_slow: "The connection could not meet the minimum upload speed.",
  storage_insufficient: "There is not enough available device storage.",
  environment_too_noisy: "Confirm that you are in a quiet place.",
};

function readNetworkSpeedKbps(): number | null {
  const connection = (
    navigator as Navigator & { connection?: { downlink?: number } }
  ).connection;
  const downlinkMbps = connection?.downlink;

  return typeof downlinkMbps === "number" && Number.isFinite(downlinkMbps)
    ? Math.max(0, Math.round(downlinkMbps * 1_000))
    : null;
}

async function readAvailableStorageMb(): Promise<number | null> {
  if (typeof navigator.storage?.estimate !== "function") {
    return null;
  }

  const { quota, usage } = await navigator.storage.estimate();
  if (typeof quota !== "number" || typeof usage !== "number") {
    return null;
  }

  return Math.max(0, Math.floor((quota - usage) / (1024 * 1024)));
}

export default function StudentInterviewPage() {
  const router = useRouter();
  const offer = useGetInterviewOfferQuery();
  const history = useGetInterviewHistoryQuery();
  const [selected, setSelected] = useState<string | null>(null);
  const recordings = useGetInterviewRecordingsQuery(selected ?? "", {
    skip: !selected,
  });
  const report = useGetInterviewReportQuery(selected ?? "", {
    skip: !selected,
  });
  const [check, checking] = useCheckInterviewDeviceMutation();
  const [checkout, buying] = useCheckoutInterviewMutation();
  const [simulatePayment, simulatingPayment] = useSimulatePaymentMutation();
  const [start, starting] = useStartInterviewMutation();
  const [audioConfirmed, setAudioConfirmed] = useState(false);
  const [quietConfirmed, setQuietConfirmed] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [deviceFailures, setDeviceFailures] = useState<string[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [paymentPending, setPaymentPending] = useState(false);
  const [paymentComplete, setPaymentComplete] = useState(false);

  const offerData = offer.data;
  const hasPassedCheck =
    Boolean(offerData?.deviceCheckPassed) ||
    deviceFailures.length === 0 && checking.isSuccess;
  const hasPurchasedSession = (offerData?.sessionsAvailable ?? 0) > 0;
  const price =
    offerData?.priceMinor == null
      ? null
      : new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: offerData.currency,
          maximumFractionDigits: 0,
        }).format(offerData.priceMinor / 100);

  async function deviceCheck() {
    setError(null);
    setDeviceFailures([]);
    let micOk = false;
    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micOk = stream.getAudioTracks().some((track) => track.readyState === "live");
    } catch {
      micOk = false;
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
    }

    try {
      const [networkKbps, storageMb] = await Promise.all([
        Promise.resolve(readNetworkSpeedKbps()),
        readAvailableStorageMb(),
      ]);
      const result = await check({
        mic_ok: micOk,
        audio_out_ok: audioConfirmed,
        quiet_env_ok: quietConfirmed,
        network_kbps: networkKbps,
        storage_mb: storageMb,
      }).unwrap();

      setDeviceFailures(result.failures);
      if (result.passed) {
        await offer.refetch();
      }
    } catch (checkError) {
      setError(checkError);
    }
  }

  async function buy() {
    setError(null);
    setPaymentPending(false);
    setPaymentComplete(false);

    try {
      const payment = await checkout({
        acknowledge_no_score_increase: acknowledged,
      }).unwrap();

      if (payment.redirect_url) {
        if (new URL(payment.redirect_url).hostname === "stub-payments.invalid") {
          const simulated = await simulatePayment({
            paymentId: payment.payment_id,
            outcome: "SUCCEEDED",
          }).unwrap();

          if (simulated.status !== "SUCCEEDED") {
            throw new Error("The development payment was not completed.");
          }

          await Promise.all([offer.refetch(), history.refetch()]);
          setPaymentComplete(true);
          return;
        }

        window.location.assign(payment.redirect_url);
        return;
      }

      setPaymentPending(true);
    } catch (checkoutError) {
      setError(checkoutError);
    }
  }

  async function begin() {
    setError(null);

    try {
      const session = await start().unwrap();
      router.push(`/student/interview/${session.id}`);
    } catch (startError) {
      setError(startError);
    }
  }

  return (
    <StudentPage>
      <div className="space-y-6">
        <section className="overflow-hidden rounded-2xl border border-[#E7E0D4] bg-white shadow-[0_8px_30px_rgba(10,25,49,0.06)]">
          <div className="bg-[linear-gradient(115deg,#F7F4EC_0%,#FFFCF7_62%,#F1EAF7_100%)] px-5 py-6 sm:px-7 sm:py-7">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="max-w-xl">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#C9BEEB] bg-white/80 px-3 py-1 text-[11px] font-bold text-[#4A3E8F]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  PRACTICE AT YOUR PACE
                </span>
                <h2 className="mt-3 text-xl font-bold tracking-tight text-[#0A1931] sm:text-2xl">
                  Get ready for your next interview
                </h2>
                <p className="mt-2 max-w-lg text-[13px] leading-6 text-[#5F6B80]">
                  Practise answering interview questions, record your responses,
                  and review your feedback when you finish.
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-3 rounded-xl border border-white/80 bg-white/80 px-4 py-3 shadow-sm">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#F1EAF7] text-[#5F4DB2]">
                  <Mic2 className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-[11px] font-medium text-[#5F6B80]">
                    Sessions ready
                  </p>
                  <p className="text-lg font-bold leading-6 text-[#0A1931]">
                    {offerData?.sessionsAvailable ?? "-"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px] lg:p-7">
            <div className="min-w-0">
              <div className="mb-4 flex items-center gap-2">
                <ShieldCheck
                  className="h-4 w-4 text-[#5F4DB2]"
                  aria-hidden="true"
                />
                <h3 className="text-[14px] font-bold text-[#0A1931]">
                  Before you begin
                </h3>
              </div>

              {offer.isLoading ? (
                <div
                  className="h-44 animate-pulse rounded-xl bg-[#F7F4EC]"
                  role="status"
                  aria-label="Loading interview availability"
                />
              ) : offer.isError ? (
                <StudentErrorState
                  error={offer.error}
                  title="Interview details could not be loaded"
                  onRetry={() => void offer.refetch()}
                />
              ) : (
                <>
                  {offerData?.openSessionId ? (
                    <div className="rounded-xl border border-[#C9BEEB] bg-[#F8F5FB] p-4 sm:p-5">
                      <p className="text-[13px] font-bold text-[#0A1931]">
                        You have an interview in progress
                      </p>
                      <p className="mt-1 text-[12px] leading-5 text-[#5F6B80]">
                        Pick up where you left off. Your saved answers will be
                        there when you return.
                      </p>
                      <Link
                        href={`/student/interview/${offerData.openSessionId}`}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#5F4DB2] px-4 py-2.5 text-[12px] font-bold text-white transition-colors hover:bg-[#4A3E8F]"
                      >
                        Resume interview
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </div>
                  ) : hasPurchasedSession && hasPassedCheck ? (
                    <div className="rounded-xl border border-[#C9BEEB] bg-[#F8F5FB] p-4 sm:p-5">
                      <p className="text-[13px] font-bold text-[#0A1931]">
                        Your next session is ready
                      </p>
                      <p className="mt-1 text-[12px] leading-5 text-[#5F6B80]">
                        You have a purchased session available to start.
                      </p>
                      <button
                        type="button"
                        onClick={() => void begin()}
                        disabled={starting.isLoading}
                        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#5F4DB2] px-4 py-2.5 text-[12px] font-bold text-white transition-colors hover:bg-[#4A3E8F] disabled:cursor-wait disabled:opacity-60"
                      >
                        <Play className="h-4 w-4" aria-hidden="true" />
                        {starting.isLoading ? "Starting…" : "Start interview"}
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex gap-3 rounded-xl border border-[#E7E0D4] bg-[#FFFCF7] p-3.5">
                          <span className="mt-0.5 text-[#5F4DB2]">
                            <Headphones className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-[#3A4761]">
                              Audio check
                            </p>
                            <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] leading-5 text-[#5F6B80]">
                              <input
                                type="checkbox"
                                checked={audioConfirmed}
                                onChange={(event) =>
                                  setAudioConfirmed(event.target.checked)
                                }
                                className="mt-1 accent-[#5F4DB2]"
                              />
                              I can hear audio from this device
                            </label>
                          </div>
                        </div>
                        <div className="flex gap-3 rounded-xl border border-[#E7E0D4] bg-[#FFFCF7] p-3.5">
                          <span className="mt-0.5 text-[#5F4DB2]">
                            <Mic2 className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold text-[#3A4761]">
                              Quiet environment
                            </p>
                            <label className="mt-2 flex cursor-pointer items-start gap-2 text-[11px] leading-5 text-[#5F6B80]">
                              <input
                                type="checkbox"
                                checked={quietConfirmed}
                                onChange={(event) =>
                                  setQuietConfirmed(event.target.checked)
                                }
                                className="mt-1 accent-[#5F4DB2]"
                              />
                              I am in a quiet place
                            </label>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E7E0D4] bg-white p-3.5">
                        <div className="min-w-0">
                          <p className="text-[12px] font-semibold text-[#3A4761]">
                            Check your device
                          </p>
                          <p className="mt-1 text-[11px] leading-5 text-[#5F6B80]">
                            We’ll check microphone access, connection speed and
                            available storage before checkout.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void deviceCheck()}
                          disabled={
                            checking.isLoading || !audioConfirmed || !quietConfirmed
                          }
                          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#C9BEEB] bg-white px-3.5 py-2 text-[11px] font-bold text-[#4A3E8F] transition-colors hover:bg-[#F1EAF7] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <RotateCw
                            className={`h-3.5 w-3.5 ${checking.isLoading ? "animate-spin" : ""}`}
                            aria-hidden="true"
                          />
                          {checking.isLoading ? "Checking…" : "Run device check"}
                        </button>
                      </div>

                      {hasPassedCheck && !deviceFailures.length && (
                        <div
                          role="status"
                          className="flex items-center gap-2 rounded-lg border border-[#B9D8C4] bg-[#E6F1EA] px-3.5 py-2.5 text-[12px] font-semibold text-[#1F6B45]"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          Device check passed. You can continue to {hasPurchasedSession
                            ? "your interview"
                            : "checkout"}.
                        </div>
                      )}

                      {deviceFailures.length > 0 && (
                        <div
                          role="alert"
                          className="rounded-lg border border-[#E9D9A9] bg-[#F7EFD6] p-3.5"
                        >
                          <p className="flex items-center gap-2 text-[12px] font-bold text-[#7A5C0E]">
                            <CircleAlert className="h-4 w-4" aria-hidden="true" />
                            A few checks need attention
                          </p>
                          <ul className="mt-2 space-y-1 pl-6 text-[11px] leading-5 text-[#7A5C0E]">
                            {deviceFailures.map((failure) => (
                              <li key={failure}>
                                {DEVICE_FAILURES[failure] ??
                                  "This device check did not pass. Please try again."}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  {offerData?.requiresAcknowledgement &&
                    !offerData.openSessionId &&
                    offerData.sessionsAvailable === 0 && (
                      <label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-xl border border-[#E9D9A9] bg-[#F7EFD6] p-3.5 text-[11px] leading-5 text-[#7A5C0E]">
                        <input
                          type="checkbox"
                          checked={acknowledged}
                          onChange={(event) =>
                            setAcknowledged(event.target.checked)
                          }
                          className="mt-1 accent-[#5F4DB2]"
                        />
                        I understand that this session will not increase my
                        score.
                      </label>
                    )}

                  {error !== null && (
                    <StudentErrorState
                      variant="inline"
                      error={error}
                      className="mt-4"
                    />
                  )}

                  {paymentPending && (
                    <div
                      role="status"
                      className="mt-4 rounded-xl border border-[#C9BEEB] bg-[#F1EAF7] p-3.5 text-[12px] leading-5 text-[#4A3E8F]"
                    >
                      Checkout was created, but no payment page was returned.
                      Your session has not been purchased yet. Please contact
                      support before trying checkout again.
                    </div>
                  )}
                  {paymentComplete && (
                    <p
                      role="status"
                      className="mt-4 rounded-xl border border-[#B9D8C4] bg-[#E6F1EA] p-3.5 text-[12px] font-semibold text-[#1F6B45]"
                    >
                      Payment confirmed. Your interview session is ready.
                    </p>
                  )}
                </>
              )}
            </div>

            <aside className="h-fit rounded-xl border border-[#E7E0D4] bg-[#FFFCF7] p-4 sm:p-5">
              <div className="flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-[#5F4DB2]" aria-hidden="true" />
                <h3 className="text-[13px] font-bold text-[#0A1931]">
                  Session checkout
                </h3>
              </div>
              <p className="mt-1 text-[11px] leading-5 text-[#5F6B80]">
                Each session is purchased separately.
              </p>
              <div className="my-4 border-t border-[#E7E0D4]" />
              <div className="flex items-end justify-between gap-3">
                <span className="text-[12px] font-medium text-[#5F6B80]">
                  Total
                </span>
                <span className="text-2xl font-bold tracking-tight text-[#0A1931]">
                  {price ?? (offerData?.onSale === false ? "Unavailable" : "-")}
                </span>
              </div>
              <p className="mt-1 text-right text-[10px] text-[#5F6B80]">
                Inclusive of applicable taxes
              </p>

              {offerData && !offerData.openSessionId && offerData.sessionsAvailable === 0 && (
                <button
                  type="button"
                  onClick={() => void buy()}
                  disabled={
                    buying.isLoading ||
                    simulatingPayment.isLoading ||
                    paymentPending ||
                    !offerData.onSale ||
                    !hasPassedCheck ||
                    (offerData.requiresAcknowledgement && !acknowledged)
                  }
                  className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#5F4DB2] px-4 py-3 text-[12px] font-bold text-white shadow-sm transition-colors hover:bg-[#4A3E8F] disabled:cursor-not-allowed disabled:bg-[#C9BEEB] disabled:text-[#4A3E8F]"
                >
                  {buying.isLoading || simulatingPayment.isLoading
                    ? "Opening secure checkout…"
                    : "Continue to payment"}
                  {!buying.isLoading && !simulatingPayment.isLoading && (
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
              )}

              {offerData && !offerData.onSale && (
                <p className="mt-3 text-center text-[11px] leading-5 text-[#5F6B80]">
                  New interview sessions are not available right now.
                </p>
              )}
              {!hasPassedCheck &&
                !offer.isLoading &&
                !offer.isError &&
                !offerData?.openSessionId && (
                  <p className="mt-2 text-center text-[10px] leading-5 text-[#5F6B80]">
                    Complete the device check to enable {hasPurchasedSession
                      ? "your interview"
                      : "payment"}.
                  </p>
                )}

              <div className="mt-5 space-y-2 border-t border-[#E7E0D4] pt-4">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#5F6B80]">
                  What we check
                </p>
                <div className="flex items-center gap-2 text-[11px] text-[#5F6B80]">
                  <Mic2 className="h-3.5 w-3.5 text-[#5F4DB2]" aria-hidden="true" />
                  Microphone access
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[#5F6B80]">
                  <Wifi className="h-3.5 w-3.5 text-[#5F4DB2]" aria-hidden="true" />
                  Connection speed
                </div>
                <div className="flex items-center gap-2 text-[11px] text-[#5F6B80]">
                  <HardDrive
                    className="h-3.5 w-3.5 text-[#5F4DB2]"
                    aria-hidden="true"
                  />
                  Available storage
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section id="interview-history" className="scroll-mt-24 rounded-2xl border border-[#E7E0D4] bg-white p-5 shadow-[0_4px_20px_rgba(10,25,49,0.04)] sm:p-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-bold text-[#0A1931]">
                Interview history
              </h2>
              <p className="mt-1 text-[11px] text-[#5F6B80]">
                Revisit your past sessions and feedback.
              </p>
            </div>
          </div>
          {history.isError ? (
            <StudentErrorState
              error={history.error}
              title="Interview history could not be loaded"
              onRetry={() => void history.refetch()}
            />
          ) : history.isLoading ? (
            <div className="h-16 animate-pulse rounded-xl bg-[#F7F4EC]" />
          ) : history.data?.length ? (
            <div className="space-y-2">
              {history.data.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => {
                    if (session.report_status === "READY") {
                      router.push(`/student/interview/${session.id}/feedback`);
                      return;
                    }
                    setSelected(session.id);
                  }}
                  className={`block w-full rounded-xl border p-3.5 text-left transition-colors ${
                    selected === session.id
                      ? "border-[#C9BEEB] bg-[#F1EAF7]"
                      : "border-[#E7E0D4] bg-white hover:bg-[#FFFCF7]"
                  }`}
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[12px] font-bold text-[#3A4761]">
                      Session {session.session_number}
                      <span className="font-medium text-[#5F6B80]">
                        {" "}
                        · {session.question_set_title}
                      </span>
                    </span>
                    <span className="rounded-full bg-[#F1EAF7] px-2.5 py-1 text-[10px] font-semibold text-[#4A3E8F]">
                      {session.state}
                    </span>
                  </span>
                  <span className="mt-1 block text-[11px] text-[#5F6B80]">
                    {session.answers_stored}/{session.questions_asked} answers
                    {session.report_status === "READY" && " · View feedback"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-[#E7E0D4] bg-[#FFFCF7] px-4 py-6 text-center text-[12px] text-[#5F6B80]">
              No interviews yet. Your completed sessions will appear here.
            </p>
          )}

          {selected && (
            <div className="mt-5 space-y-4 border-t border-[#F0EBDF] pt-5">
              <h3 className="text-[13px] font-bold text-[#0A1931]">
                Session review
              </h3>
              {recordings.isError ? (
                <StudentErrorState
                  error={recordings.error}
                  title="Recordings could not be loaded"
                />
              ) : recordings.isLoading ? (
                <div className="h-20 animate-pulse rounded-xl bg-[#F7F4EC]" />
              ) : recordings.data?.length ? (
                recordings.data.map((recording) => (
                  <div
                    key={recording.question_index}
                    className="rounded-xl border border-[#E7E0D4] p-4"
                  >
                    <p className="text-[12px] font-semibold text-[#3A4761]">
                      {recording.prompt}
                    </p>
                    <StudentAudioPlayer src={recording.url} label={`Answer ${recording.question_index + 1}`} className="mt-3" />
                    {recording.transcript && (
                      <p className="mt-3 text-[11px] leading-5 text-[#5F6B80]">
                        {recording.transcript}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-[12px] text-[#5F6B80]">
                  No recordings are available for this session.
                </p>
              )}

              {report.isError ? (
                <StudentErrorState
                  error={report.error}
                  title="Session feedback could not be loaded"
                />
              ) : (
                <>
                  <h4 className="text-[12px] font-bold text-[#3A4761]">
                    Feedback · {report.data?.status ?? "Loading"}
                  </h4>
                  {report.data?.dimensions.map((dimension) => (
                    <p
                      key={dimension.code}
                      className="text-[11px] leading-5 text-[#5F6B80]"
                    >
                      <b className="text-[#3A4761]">
                        {dimension.label}: {dimension.level}
                      </b>{" "}
                      · {dimension.what_good_looks_like}
                    </p>
                  ))}
                </>
              )}
            </div>
          )}
        </section>
      </div>
    </StudentPage>
  );
}
