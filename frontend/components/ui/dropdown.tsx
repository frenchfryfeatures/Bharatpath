"use client";

import {
  Check,
  ChevronDown,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { createPortal } from "react-dom";
import { useFloatingPanel } from "@/lib/hooks/use-floating-panel";

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

interface DropdownProps<T extends string = string> {
  id?: string;
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
  overlayOwner?: string;
  overlayParent?: string;
}

export function Dropdown<T extends string = string>({
  id,
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
  overlayOwner,
  overlayParent,
}: DropdownProps<T>) {
  const [open, setOpen] =
    useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [owner, setOwner] = useState<string>();
  const menuStyle = useFloatingPanel(open, triggerRef, menuRef, { maxHeight: 280, align });
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!dropdownRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    const frame = requestAnimationFrame(() => {
      if (menuStyle.visibility !== "visible") return;
      const selected = menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)');
      const first = menuRef.current?.querySelector<HTMLElement>('[role="option"]:not(:disabled)');
      (selected ?? first ?? menuRef.current)?.focus({ preventScroll: true });
      selected?.scrollIntoView({ block: "nearest" });
    });
    document.addEventListener("pointerdown", outside);
    return () => { cancelAnimationFrame(frame); document.removeEventListener("pointerdown", outside); };
  }, [open, menuStyle.visibility]);

  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  function handleSelect(
    option: DropdownOption<T>,
  ) {
    if (option.disabled) {
      return;
    }

    onChange(option.value);
    closeMenu();
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
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          setOwner(overlayOwner ?? event.currentTarget.closest<HTMLElement>("[data-overlay-owner]")?.dataset.overlayOwner);
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (["ArrowDown", "ArrowUp"].includes(event.key)) {
            event.preventDefault();
            setOwner(overlayOwner ?? event.currentTarget.closest<HTMLElement>("[data-overlay-owner]")?.dataset.overlayOwner);
            setOpen(true);
          }
          if (event.key === "Escape" && open) { event.stopPropagation(); closeMenu(); }
        }}
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
      {open && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          data-overlay-owner={owner}
          data-overlay-parent={overlayParent}
          style={menuStyle}
          aria-label={ariaLabel || placeholder}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.stopPropagation(); closeMenu(); return; }
            if (event.key === "Tab") { closeMenu(); return; }
            const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
            if (!keys.includes(event.key)) return;
            event.preventDefault();
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)'));
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
            items[next]?.focus();
          }}
          role="listbox"
          className={`
            z-[1100]
            overscroll-contain
            overflow-y-auto
            rounded-[9px]
            border
            border-[#e1e4e9]
            bg-white
            p-[4px]
            shadow-[0_8px_24px_rgba(19,26,38,0.12)]
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
        </div>, document.body
      )}
    </div>
  );
}
