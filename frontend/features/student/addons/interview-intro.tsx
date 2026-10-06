"use client";

import { Clock, EyeOff, Info, MicVocal, ShieldCheck } from "lucide-react";

import { useGetInterviewOfferQuery } from "@/store/student";
import { getApiErrorMessage } from "@/lib/api/error-message";
import {
  CommerceBadge,
  EmptyState,
  NoteStrip,
  StudentCard,
} from "@/features/student/components";
import { StudentPage, StudentTopBar } from "@/features/student/shell";

export function InterviewIntro() {
  const offer = useGetInterviewOfferQuery();
  const price =
    !offer.data?.onSale || offer.data.priceMinor == null
      ? "Unavailable"
      : new Intl.NumberFormat("en-IN", {
          style: "currency",
          currency: offer.data.currency || "INR",
          maximumFractionDigits: 0,
        }).format(offer.data.priceMinor / 100);

  return (
    <StudentPage>
      <div className="flex flex-col gap-5">
        <StudentTopBar
          title="Mock interview"
          right={
            <CommerceBadge icon={<MicVocal size={12} />}>{price}</CommerceBadge>
          }
        />

        {offer.isLoading ? (
          <StudentCard>Loading interview offer…</StudentCard>
        ) : offer.error ? (
          <EmptyState
            title="Interview unavailable"
            message={getApiErrorMessage(
              offer.error,
              "Could not load the interview offer.",
            )}
          />
        ) : (
          <>
            <div className="grid h-[172px] place-items-center rounded-[24px] border border-[#BDC8E3] bg-[#CFD8ED]">
              <span className="text-[15px] font-semibold text-[#4A3E8F]">
                {offer.data?.openSessionId
                  ? "A session is ready to continue"
                  : `${offer.data?.sessionsAvailable ?? 0} sessions available`}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              <h1 className="text-[28px] font-bold text-[#0A1931]">
                Practise before it counts
              </h1>
              <p className="text-[15px] leading-[22px] text-[#3A4761]">
                Complete a device check before checkout. Your evaluation is
                feedback and never changes your score.
              </p>
            </div>
            <StudentCard padded={false} className="px-4">
              <Fact icon={<Clock size={19} />} first>
                Finish each answer in the active session.
              </Fact>
              <Fact icon={<ShieldCheck size={19} />}>
                Device check{" "}
                {offer.data?.deviceCheckPassed ? "passed" : "required"}.
              </Fact>
              <Fact icon={<EyeOff size={19} />}>
                {offer.data?.willIncreaseScore
                  ? "Completion can increase your score."
                  : "Feedback only - your score does not move."}
              </Fact>
            </StudentCard>
            <NoteStrip icon={<Info size={16} />}>
              Recording and browser-device checks are not yet implemented in this
              web portal. No payment or session will be created until that flow
              can complete safely.
            </NoteStrip>
          </>
        )}
      </div>
    </StudentPage>
  );
}

function Fact({
  children,
  icon,
  first,
}: {
  children: React.ReactNode;
  icon: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div
      className={[
        "flex items-center gap-3 py-3.5 text-[#3A4761]",
        first ? "" : "border-t border-[#F0EBDF]",
      ].join(" ")}
    >
      <span className="text-[#5E4DB2]">{icon}</span>
      <span className="flex-1 text-[14px] leading-5">{children}</span>
    </div>
  );
}
