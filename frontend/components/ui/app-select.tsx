"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { ChevronDown, Loader2, Search } from "lucide-react";

interface AppSelectOption {
  value: string;
  label: string;
}

interface AppSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: AppSelectOption[];
  className?: string;
  menuClassName?: string;
  menuPlacement?: "top" | "bottom" | "auto";
  /** Render outside clipping and scrolling ancestors, positioned at the trigger. */
  portal?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  /** Show a search box inside the menu to filter options. Off by default. */
  searchable?: boolean;
  /** Placeholder for the search box (only used when searchable). */
  searchPlaceholder?: string;
  /** Receives search text for server-backed option loading. */
  onSearchChange?: (value: string) => void;
  /** Shows a progress row while server-backed options are loading. */
  isSearching?: boolean;
  /** Copy shown in the initial server-backed loading row. */
  loadingMessage?: string;
  /** Message shown when the current search has no options. */
  noOptionsMessage?: string;
  /** Notifies server-backed callers when the menu opens or closes. */
  onOpenChange?: (open: boolean) => void;
  /** Whether another server-backed option page is available. */
  hasMoreOptions?: boolean;
  /** Loads the next option page when the menu scroll reaches its end. */
  onLoadMoreOptions?: () => void;
  /** Shows a progress row beneath the currently loaded options. */
  isLoadingMoreOptions?: boolean;
}

export function AppSelect({
  value,
  onChange,
  options,
  className = "",
  menuClassName = "",
  menuPlacement = "bottom",
  portal = false,
  placeholder = "Select",
  ariaLabel,
  searchable = false,
  searchPlaceholder = "Search",
  onSearchChange,
  isSearching = false,
  loadingMessage = "Searching...",
  noOptionsMessage = "No matches",
  onOpenChange,
  hasMoreOptions = false,
  onLoadMoreOptions,
  isLoadingMoreOptions = false,
}: Readonly<AppSelectProps>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const containerRef =
    useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [menuPosition, setMenuPosition] = useState<{
    left: number;
    width: number;
    top?: number;
    bottom?: number;
    maxHeight: number;
  } | null>(null);
  const [resolvedPlacement, setResolvedPlacement] = useState<"top" | "bottom">("bottom");

  const selectedOption = options.find(
    (option) => option.value === value,
  );

  const visibleOptions =
    searchable && query.trim()
      ? options.filter((option) =>
          option.label
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
        )
      : options;

  const closeMenu = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
    if (query) {
      setQuery("");
      onSearchChange?.("");
    }
  }, [onOpenChange, onSearchChange, query]);

  /* =====================================================
     CLOSE WHEN CLICKING OUTSIDE
     ===================================================== */

  useEffect(() => {
    function handleOutsideClick(
      event: MouseEvent,
    ) {
      if (
        !containerRef.current?.contains(event.target as Node) &&
        !menuRef.current?.contains(event.target as Node)
      ) {
        closeMenu();
      }
    }

    document.addEventListener(
      "mousedown",
      handleOutsideClick,
    );

    return () => {
      document.removeEventListener(
        "mousedown",
        handleOutsideClick,
      );
    };
  }, [closeMenu]);

  useEffect(() => {
    if (!open || !portal) return;

    function updatePosition() {
      const trigger = containerRef.current?.querySelector("button");
      if (!trigger) return;

      const rect = trigger.getBoundingClientRect();
      const viewportPadding = 8;
      const gap = 6;
      const spaceAbove = Math.max(0, rect.top - gap - viewportPadding);
      const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - gap - viewportPadding);
      const preferredHeight = Math.min(280, window.innerHeight * 0.45);
      const placement = menuPlacement === "auto"
        ? spaceBelow >= preferredHeight || spaceBelow >= spaceAbove ? "bottom" : "top"
        : menuPlacement;
      const availableSpace = placement === "top" ? spaceAbove : spaceBelow;
      const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2);
      const left = Math.min(
        Math.max(viewportPadding, rect.left),
        window.innerWidth - width - viewportPadding,
      );

      setResolvedPlacement(placement);
      setMenuPosition({
        left,
        width,
        ...(placement === "top"
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap }),
        maxHeight: availableSpace,
      });
    }

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [menuPlacement, open, portal]);

  /* =====================================================
     CLOSE WITH ESCAPE
     ===================================================== */

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleEscape(
      event: KeyboardEvent,
    ) {
      if (event.key === "Escape") {
        closeMenu();
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
  }, [closeMenu, open]);

  // Move focus into the search box when a searchable menu opens.
  useEffect(() => {
    if (open && searchable && (!portal || menuPosition)) {
      searchInputRef.current?.focus();
    }
  }, [menuPosition, open, portal, searchable]);

  /* =====================================================
     SELECT OPTION
     ===================================================== */

  function handleSelect(option: AppSelectOption) {
    onChange(option.value);
    closeMenu();
  }

  function handleSearchChange(value: string) {
    setQuery(value);
    onSearchChange?.(value);
  }

  function handleOptionsScroll(event: React.UIEvent<HTMLDivElement>) {
    const menu = event.currentTarget;
    const distanceFromBottom =
      menu.scrollHeight - menu.scrollTop - menu.clientHeight;

    if (
      distanceFromBottom <= 40 &&
      hasMoreOptions &&
      !isLoadingMoreOptions
    ) {
      onLoadMoreOptions?.();
    }
  }

  const menuContents = (
    <>
      {searchable && (
        <div className="mb-1 flex items-center gap-2 rounded-[7px] bg-[#f5f6f9] px-2.5 py-1.5">
          <Search size={13} className="shrink-0 text-[#98a1b0]" />
          <input
            ref={searchInputRef}
            type="text"
            value={query}
            onChange={(event) => handleSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full bg-transparent text-[11px] text-[#283247] outline-none placeholder:text-[#98a1b0]"
          />
        </div>
      )}

      <div
        onScroll={handleOptionsScroll}
        className="bp-scrollbar max-h-[min(14rem,45vh)] overflow-y-auto overscroll-contain"
      >
        {isSearching ? (
          <p role="status" className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-[#687386]">
            <Loader2 aria-hidden="true" size={13} className="animate-spin" />
            {loadingMessage}
          </p>
        ) : visibleOptions.length > 0 ? (
          visibleOptions.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => handleSelect(option)}
                className={`flex w-full items-center rounded-[7px] px-2.5 py-2 text-left text-[11px] transition-colors ${
                  selected
                    ? "bg-[#f2f0ff] font-semibold text-[#51449a]"
                    : "font-medium text-[#4f5969] hover:bg-[#f7f8fa]"
                }`}
              >
                {option.label}
              </button>
            );
          })
        ) : (
          <p className="px-2.5 py-2 text-[11px] text-[#98a1b0]">{noOptionsMessage}</p>
        )}
        {isLoadingMoreOptions ? (
          <p role="status" className="flex items-center gap-2 px-2.5 py-2 text-[11px] text-[#687386]">
            <Loader2 aria-hidden="true" size={13} className="animate-spin" />
            Loading more...
          </p>
        ) : null}
      </div>
    </>
  );
  const inlinePlacement = menuPlacement === "auto" ? resolvedPlacement : menuPlacement;

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
    >
      {/* =================================================
          TRIGGER
          ================================================= */}

      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            closeMenu();
          } else {
            setOpen(true);
            onOpenChange?.(true);
          }
        }}
        className="
          flex h-[36px] w-full
          items-center justify-between
          gap-2
          rounded-[8px]
          border border-[#e1e5ea]
          bg-white
          px-3
          text-left
          transition-colors
          hover:bg-[#f8f9fb]
          focus:outline-none
        "
      >
        <span className="truncate text-[11px] font-semibold text-[#283247]">
          {selectedOption?.label ?? placeholder}
        </span>

        <ChevronDown
          size={14}
          className={`shrink-0 text-[#687386] transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {/* =================================================
          DROPDOWN
          ================================================= */}

      {open && (
        portal
          ? menuPosition
            ? createPortal(
                <div
                  ref={menuRef}
                  role="listbox"
                  style={{ ...menuPosition, position: "fixed" }}
                  className={`z-[120] min-w-[140px] overflow-hidden rounded-[10px] border border-[#e1e5ea] bg-white p-1 shadow-[0_8px_24px_rgba(19,26,38,0.10)] ${menuClassName}`}
                >
                  {menuContents}
                </div>,
                document.body,
              )
            : null
          : (
              <div
                ref={menuRef}
                role="listbox"
                className={`absolute right-0 ${inlinePlacement === "top" ? "bottom-[calc(100%+6px)]" : "top-[calc(100%+6px)]"} z-[120] w-full min-w-[140px] overflow-hidden rounded-[10px] border border-[#e1e5ea] bg-white p-1 shadow-[0_8px_24px_rgba(19,26,38,0.10)] ${menuClassName}`}
              >
                {menuContents}
              </div>
            )
      )}
    </div>
  );
}
