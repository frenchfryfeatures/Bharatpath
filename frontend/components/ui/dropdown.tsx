"use client";

import {
  Check,
  ChevronDown,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
} from "react";

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface DropdownProps<T extends string = string> {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;

  placeholder?: string;
  ariaLabel?: string;

  className?: string;
  buttonClassName?: string;
  menuClassName?: string;

  disabled?: boolean;

  align?: "left" | "right";

  width?: string;
}

export function Dropdown<T extends string = string>({
  value,
  options,
  onChange,
  placeholder = "Select",
  ariaLabel,
  className = "",
  buttonClassName = "",
  menuClassName = "",
  disabled = false,
  align = "left",
  width = "w-[130px]",
}: DropdownProps<T>) {
  const [open, setOpen] =
    useState(false);

  const dropdownRef =
    useRef<HTMLDivElement>(null);

  const selectedOption =
    options.find(
      (option) => option.value === value,
    );

  /*
   * Close when clicking outside.
   */
  useEffect(() => {
    function handleClickOutside(
      event: MouseEvent,
    ) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(
          event.target as Node,
        )
      ) {
        setOpen(false);
      }
    }

    document.addEventListener(
      "mousedown",
      handleClickOutside,
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleClickOutside,
      );
    };
  }, []);

  /*
   * Close dropdown on Escape.
   */
  useEffect(() => {
    function handleEscape(
      event: KeyboardEvent,
    ) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener(
      "keydown",
      handleEscape,
    );

    return () => {
      document.removeEventListener(
        "keydown",
        handleEscape,
      );
    };
  }, []);

  function handleSelect(
    option: DropdownOption<T>,
  ) {
    if (option.disabled) {
      return;
    }

    onChange(option.value);
    setOpen(false);
  }

  return (
    <div
      ref={dropdownRef}
      className={`
        relative
        ${width}
        ${className}
      `}
    >
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() =>
          setOpen((current) => !current)
        }
        className={`
          flex
          h-[36px]
          w-full
          items-center
          justify-between
          gap-2
          rounded-[9px]
          border
          border-[#e3e6eb]
          bg-white
          px-[12px]
          text-left
          text-[12px]
          font-[500]
          text-[#151b2b]
          outline-none
          transition-all
          hover:border-[#cfd4dc]
          focus:border-[#b7b1ee]
          focus:ring-2
          focus:ring-[#5b4fcf]/10
          disabled:cursor-not-allowed
          disabled:opacity-50
          ${
            open
              ? "border-[#b7b1ee] ring-2 ring-[#5b4fcf]/10"
              : ""
          }
          ${buttonClassName}
        `}
      >
        <span className="truncate">
          {selectedOption?.label ??
            placeholder}
        </span>

        <ChevronDown
          size={14}
          strokeWidth={1.8}
          className={`
            shrink-0
            text-[#6c7482]
            transition-transform
            duration-150
            ${open ? "rotate-180" : ""}
          `}
        />
      </button>

      {/* Menu */}
      {open && (
        <div
          role="listbox"
          className={`
            absolute
            z-[100]
            mt-[5px]
            max-h-[280px]
            w-full
            overflow-y-auto
            rounded-[9px]
            border
            border-[#e1e4e9]
            bg-white
            p-[4px]
            shadow-[0_8px_24px_rgba(19,26,38,0.12)]
            ${align === "right"
              ? "right-0"
              : "left-0"}
            ${menuClassName}
          `}
        >
          {options.map((option) => {
            const isSelected =
              option.value === value;

            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                disabled={option.disabled}
                onClick={() =>
                  handleSelect(option)
                }
                className={`
                  flex
                  min-h-[34px]
                  w-full
                  items-center
                  justify-between
                  gap-3
                  rounded-[6px]
                  px-[9px]
                  py-[7px]
                  text-left
                  text-[12px]
                  font-[500]
                  transition-colors
                  ${
                    option.disabled
                      ? "cursor-not-allowed text-[#b7bbc3]"
                      : "text-[#151b2b] hover:bg-[#f4f6f8]"
                  }
                  ${
                    isSelected
                      ? "bg-[#edf3fc] text-[#2f5da8]"
                      : ""
                  }
                `}
              >
                <span className="truncate">
                  {option.label}
                </span>

                {isSelected && (
                  <Check
                    size={14}
                    strokeWidth={2}
                    className="shrink-0 text-[#2f5da8]"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}