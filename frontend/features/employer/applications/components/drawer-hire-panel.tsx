interface HirePanelProps {
  employerConfirmed: boolean;
  candidateConfirmed: boolean;
  canConfirmHire: boolean;
  onConfirmHire: () => void;
  canReject: boolean;
  onReject: () => void;
}

export function HirePanel({
  employerConfirmed,
  candidateConfirmed,
  canConfirmHire,
  onConfirmHire,
  canReject,
  onReject,
}: HirePanelProps) {
  const description =
    employerConfirmed && candidateConfirmed
      ? "Both sides confirmed. This hire is final."
      : employerConfirmed
        ? "You’ve confirmed. Waiting on the candidate to confirm from their app."
        : "Move this applicant to the final stage, then confirm from your side. The candidate confirms separately before it counts as a billable hire.";

  return (
    <div className="flex flex-col gap-2.5 rounded-[10px] bg-[#f3f4f7] p-4">
      <span className="text-[13px] font-semibold leading-[17px] text-[#151b2b]">
        Confirm hire
      </span>

      <span className="text-[12px] font-normal leading-[17px] text-[#4f5969]">
        {description}
      </span>

      {canConfirmHire && (
        <button
          type="button"
          onClick={onConfirmHire}
          className="mt-1 flex h-10 w-full cursor-pointer items-center justify-center rounded-lg border-0 bg-[#16845d] px-4 text-[13px] font-semibold text-white transition hover:bg-[#11734f]"
        >
          Mark as hired
        </button>
      )}
      {canReject && (
        <button
          type="button"
          onClick={onReject}
          className="mt-1 flex h-10 w-full cursor-pointer items-center justify-center rounded-lg border border-[#d7dbe3] bg-white px-4 text-[13px] font-semibold text-[#a12835] transition hover:bg-[#fff1f2]"
        >
          Reject application
        </button>
      )}
    </div>
  );
}
