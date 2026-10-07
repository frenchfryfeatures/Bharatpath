import { ArrowLeft, X } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/button";

export interface OnboardingBackButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label?: string;
  variant?: "portal" | "student";
  buttonVariant?: ButtonVariant;
  size?: ButtonSize;
  children?: ReactNode;
}

/**
 * Back button for onboarding and wizard flows.
 * Uses the portal design system by default (matching the UI of other buttons in
 * Employer, College, and Admin portals: rounded-[10px], h-[42px], General Sans).
 * Student portal uses its own dedicated StudentBackButton.
 */
export function OnboardingBackButton({
  className = "",
  label = "Back",
  variant = "portal",
  buttonVariant = "secondary",
  size = "lg",
  disabled,
  onClick,
  children,
  ...props
}: OnboardingBackButtonProps) {
  if (variant === "student") {
    return (
      <button
        {...props}
        type="button"
        disabled={disabled}
        onClick={onClick}
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

  return (
    <Button
      type="button"
      variant={buttonVariant}
      size={size}
      icon={
        label === "Close" ? (
          <X className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        )
      }
      className={`shrink-0 ${className}`}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      {children ?? label}
    </Button>
  );
}

export const PortalBackButton = OnboardingBackButton;
