import { ArrowLeft, X } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";

export function OnboardingBackButton({
  className = "",
  label = "Back",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label?: string;
}) {
  return (
    <button {...props} type="button" className={`inline-flex h-14 shrink-0 cursor-pointer items-center justify-center gap-2 self-start rounded-full border border-[#DDD6C7] bg-white px-5 font-sans text-[16px] font-semibold leading-5 text-[#0A1931] transition hover:bg-[#F7F4EC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#5F4DB2] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}>
      {label === "Close" ? (
        <X className="h-4 w-4" aria-hidden="true" />
      ) : (
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      )}
      {label}
    </button>
  );
}
