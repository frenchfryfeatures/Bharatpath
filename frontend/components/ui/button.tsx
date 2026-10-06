import React, { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";
import { ArrowLeft, Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "dark" | "outline" | "ghost";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconPosition?: "left" | "right";
  /**
   * Async loading state: shows a spinner in place of the leading icon,
   * disables the button (preventing double submits) and preserves width.
   */
  isLoading?: boolean;
  /** Optional text shown while loading (e.g. "Saving…"). Defaults to children. */
  loadingText?: ReactNode;
  children?: ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    "bg-[#5b4fcf] text-white hover:bg-[#4f43bf] active:bg-[#4539af] shadow-xs border border-transparent",
  secondary:
    "bg-white text-[#303747] border border-[#dfe2e8] hover:bg-[#f8f9fb] active:bg-[#f1f3f7] shadow-2xs",
  dark:
    "bg-[#151b2b] text-white hover:bg-[#20283d] active:bg-[#0c101a] border border-transparent shadow-xs",
  outline:
    "bg-transparent text-[#4f5666] border border-[#dfe2e8] hover:bg-[#f8f9fb] hover:text-[#151b2b]",
  ghost:
    "bg-transparent text-[#5d6673] hover:bg-[#f3f4f7] hover:text-[#151b2b] border border-transparent",
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-[32px] px-3 text-[12px] gap-1.5 rounded-[8px]",
  md: "h-[36px] px-3.5 text-[13px] gap-2 rounded-[10px]",
  lg: "h-[42px] px-4 text-[14px] gap-2.5 rounded-[10px]",
};

const SPINNER_SIZE: Record<ButtonSize, number> = {
  sm: 14,
  md: 15,
  lg: 16,
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      icon,
      iconPosition = "left",
      isLoading = false,
      loadingText,
      className = "",
      disabled,
      children,
      ...props
    },
    ref,
  ) => {
    const label = isLoading && loadingText !== undefined ? loadingText : children;
    const spinner = (
      <Loader2
        aria-hidden="true"
        size={SPINNER_SIZE[size]}
        strokeWidth={2}
        className="shrink-0 animate-spin"
      />
    );

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        className={`inline-flex items-center justify-center font-semibold transition-all duration-150 cursor-pointer select-none disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
        style={{ fontFamily: "'General Sans', sans-serif" }}
        {...props}
      >
        {isLoading && spinner}
        {!isLoading && icon && iconPosition === "left" && (
          <span className="shrink-0">{icon}</span>
        )}
        {label && <span>{label}</span>}
        {!isLoading && icon && iconPosition === "right" && (
          <span className="shrink-0">{icon}</span>
        )}
      </button>
    );
  },
);

Button.displayName = "Button";

export interface BackButtonProps extends Omit<ButtonProps, "icon"> {
  label?: ReactNode;
}

export const BackButton = forwardRef<HTMLButtonElement, BackButtonProps>(
  (
    {
      label = "Back",
      variant = "secondary",
      size = "lg",
      children,
      className = "",
      ...props
    },
    ref,
  ) => {
    return (
      <Button
        ref={ref}
        variant={variant}
        size={size}
        icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}
        className={className}
        {...props}
      >
        {children ?? label}
      </Button>
    );
  },
);

BackButton.displayName = "BackButton";

