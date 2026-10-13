"use client";
import { useEffect, useRef } from "react";
import { useConfirmResumeVersionMutation } from "@/store/student";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { showFormError } from "@/lib/feedback/form-error";
import { PillButton } from "./ui";
import { StudentBackButton } from "@/features/student/components/student-back-button";

export function PaidScoringStep({
  versionId,
  onConfirmed,
  onBack,
}: {
  versionId: string;
  onConfirmed: (at: string) => void;
  onBack: () => void;
}) {
  const [confirm, state] = useConfirmResumeVersionMutation();
  const started = useRef(false);
  const start = async () => {
    try {
      const result = await confirm(versionId).unwrap();
      onConfirmed(result.confirmedAt);
    } catch (failure) {
      showFormError(
        getApiErrorMessage(
          failure,
          "Scoring could not start. Confirm your membership is active and try again.",
        ),
        { portal: "student" },
      );
    }
  };
  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void start();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold">Start your resume score</h1>
      <p>
        Membership access is checked before your reviewed resume is confirmed
        for scoring.
      </p>
      <div className="flex items-center gap-3">
      <StudentBackButton onClick={onBack} disabled={state.isLoading} />
      <PillButton className="flex-1" disabled={state.isLoading} onClick={() => void start()}>
        {state.isLoading ? "Starting scoring…" : "Try again"}
      </PillButton>
      </div>
    </div>
  );
}
