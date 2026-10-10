"use client";

import { useRouter } from "next/navigation";

import { ErrorState, type ErrorStateProps } from "@/components/ui";
import { getApiErrorCode, getApiErrorParams, getApiErrorStatus } from "@/lib/api/error-message";
import { setActiveTab } from "@/store/employer/settings";
import { useAppDispatch } from "@/store/hooks";

export function isSubscriptionRequired(error: unknown): boolean {
  return (
    getApiErrorCode(error) === "subscription_required" ||
    getApiErrorStatus(error) === 402
  );
}

export function isKybRequired(error: unknown): boolean {
  return getApiErrorCode(error) === "kyb_required";
}

/** Words for where the organisation's verification stands. */
function kybCopy(status: unknown): { message: string; canAct: boolean } {
  switch (status) {
    case "SUBMITTED":
    case "UNDER_REVIEW":
      return {
        message:
          "Your business verification is submitted and waiting for review. You can use this part of BharatPath once it is approved.",
        canAct: false,
      };
    case "MORE_INFO_REQUIRED":
      return {
        message:
          "The reviewer needs more information about your business. Update your verification to continue.",
        canAct: true,
      };
    case "REJECTED":
      return {
        message:
          "Your business verification was not approved. Review the details and submit it again.",
        canAct: true,
      };
    default:
      return {
        message:
          "Verify your business to use this part of BharatPath. It only takes a few details.",
        canAct: true,
      };
  }
}

/**
 * The one error surface for the employer portal. Every page and section that
 * fails to load renders through it, so a missing subscription (402) looks and
 * reads the same on Candidates, Jobs, Applications and the rest, and every
 * other failure uses the same panel.
 *
 * Use `variant="inline"` only for a banner inside a form or beside a control.
 */
export function EmployerErrorState({
  variant = "block",
  ...props
}: Readonly<ErrorStateProps>) {
  const router = useRouter();
  const dispatch = useAppDispatch();

  if (isKybRequired(props.error)) {
    const { message, canAct } = kybCopy(getApiErrorParams(props.error)?.kyb_status);

    return (
      <ErrorState
        {...props}
        variant="block"
        title="Business verification required"
        message={message}
        onRetry={undefined}
        action={
          canAct ? (
            <button
              type="button"
              onClick={() => {
                // Verification lives on the Company tab of settings.
                dispatch(setActiveTab("company"));
                router.push("/employer/settings");
              }}
              className="cursor-pointer rounded-lg bg-[#17233a] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#223453]"
            >
              Open verification
            </button>
          ) : undefined
        }
      />
    );
  }

  if (isSubscriptionRequired(props.error)) {
    return (
      <ErrorState
        {...props}
        variant="block"
        title="Subscription required"
        message="An active subscription is required to use this part of BharatPath."
        onRetry={undefined}
        action={
          <button
            type="button"
            onClick={() => {
              // The settings page keeps its tab in Redux, not the URL.
              dispatch(setActiveTab("subscription"));
              router.push("/employer/settings");
            }}
            className="cursor-pointer rounded-lg bg-[#17233a] px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-[#223453]"
          >
            View plans
          </button>
        }
      />
    );
  }

  return (
    <ErrorState
      {...props}
      variant={variant}
      title={variant === "block" ? (props.title ?? "Something went wrong") : props.title}
    />
  );
}
