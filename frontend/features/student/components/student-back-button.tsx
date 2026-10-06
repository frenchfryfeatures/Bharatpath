import { ArrowLeft, X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface StudentBackButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label?: string;
  children?: ReactNode;
}

/**
 * Dedicated back button for the Student portal.
 * Retains the candidate/student visual language (cream border, rounded-full pill shape).
 */
export function StudentBackButton({
  className = "",
  label = "Back",
  children,
  ...props
}: StudentBackButtonProps) {
  return (
    <button
      {...props}
      type="button"
      className={`inline-flex h-14 shrink-0 cursor-pointer items-center justify-center gap-2 self-start rounded-full border border-[#DDD6C7] bg-white px-5 font-sans text-[16px] font-semibold leading-5 text-[#0A1931] transition hover:bg-[#F7F4EC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F4DB2] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    >
      {label === "Close" ? (
        <X className="h-4 w-4" aria-hidden="true" />
      ) : (
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      )}
      {children ?? label}
    </button>
  );
}

export const StudentOnboardingBackButton = StudentBackButton;
