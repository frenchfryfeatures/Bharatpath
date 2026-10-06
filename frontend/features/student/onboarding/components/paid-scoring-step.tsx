"use client";
import { useEffect, useRef, useState } from "react";
import { useConfirmResumeVersionMutation } from "@/store/student";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { PillButton } from "./ui";
import { OnboardingBackButton } from "@/components/common/onboarding-back-button";

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
  const [error, setError] = useState("");
  const started = useRef(false);
  const start = async () => {
    setError("");
    try {
      const result = await confirm(versionId).unwrap();
      onConfirmed(result.confirmedAt);
    } catch (failure) {
      setError(
        getApiErrorMessage(
          failure,
          "Scoring could not start. Confirm your membership is active and try again.",
        ),
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
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
      <OnboardingBackButton onClick={onBack} disabled={state.isLoading} />
      <PillButton className="flex-1" disabled={state.isLoading} onClick={() => void start()}>
        {state.isLoading ? "Starting scoring…" : "Try again"}
      </PillButton>
      </div>
    </div>
  );
}
