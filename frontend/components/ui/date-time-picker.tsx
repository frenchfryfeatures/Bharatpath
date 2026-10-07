"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute);

type Placement = { top: number; left: number; width: number; maxHeight: number };

interface DateTimePickerProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
  invalid?: boolean;
  disabled?: boolean;
  required?: boolean;
  ariaDescribedBy?: string;
  ariaLabel?: string;
  dateOnly?: boolean;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function toValue(date: Date, dateOnly = false) {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return dateOnly ? day : `${day}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseValue(value: string, dateOnly = false) {
  if (!value) return null;
  const match = (dateOnly
    ? /^(\d{4})-(\d{2})-(\d{2})$/
    : /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/).exec(value);
  if (!match) return null;
  const date = new Date(+match[1], +match[2] - 1, +match[3], +(match[4] ?? 0), +(match[5] ?? 0));
  return date.getFullYear() === +match[1]
    && date.getMonth() === +match[2] - 1
    && date.getDate() === +match[3] ? date : null;
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function displayValue(value: string, dateOnly = false) {
  const date = parseValue(value, dateOnly);
  if (!date) return "";
  if (dateOnly) {
    return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  }
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function calendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
}

export function DateTimePicker({
  id,
  value,
  onChange,
  onBlur,
  placeholder,
  className = "",
  invalid = false,
  disabled = false,
  required = false,
  ariaDescribedBy,
  ariaLabel,
  dateOnly = false,
}: Readonly<DateTimePickerProps>) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => parseValue(value, dateOnly), [value, dateOnly]);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const initial = parseValue(value, dateOnly) ?? new Date();
    return new Date(initial.getFullYear(), initial.getMonth(), 1);
  });
  const [placement, setPlacement] = useState<Placement | null>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    setPlacement(null);
    onBlur?.();
    if (restoreFocus) triggerRef.current?.focus();
  }, [onBlur]);

  const positionPopover = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const margin = 8;
    const gap = 6;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const width = Math.min(320, viewportWidth - margin * 2);
    const popoverHeight = dateOnly ? 340 : 420;
    const estimatedHeight = Math.min(popoverHeight, viewportHeight - margin * 2);
    const roomBelow = viewportHeight - rect.bottom - margin;
    const roomAbove = rect.top - margin;
    const placeAbove = roomBelow < Math.min(estimatedHeight, 300) && roomAbove > roomBelow;
    const availableHeight = Math.max(0, (placeAbove ? roomAbove : roomBelow) - gap);
    const maxHeight = Math.max(0, Math.min(popoverHeight, viewportHeight - margin * 2, availableHeight));
    const preferredLeft = rect.left + rect.width / 2 - width / 2;
    const left = Math.min(Math.max(margin, preferredLeft), viewportWidth - width - margin);
    const top = placeAbove
      ? Math.max(margin, rect.top - gap - Math.min(estimatedHeight, maxHeight))
      : rect.bottom + gap;
    setPlacement({ top, left, width, maxHeight });
  }, [dateOnly]);

  useEffect(() => {
    if (!open) return;
    positionPopover();
    const reposition = () => positionPopover();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, positionPopover]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !popoverRef.current?.contains(target)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        close(true);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [close, open]);

  function openPicker() {
    const current = selected ?? new Date();
    setVisibleMonth(new Date(current.getFullYear(), current.getMonth(), 1));
    setOpen(true);
  }

  function chooseDay(day: Date) {
    if (dateOnly) {
      onChange(toValue(day, true));
      close(true);
      return;
    }
    const next = new Date(day);
    next.setHours(selected?.getHours() ?? 9, selected?.getMinutes() ?? 0, 0, 0);
    onChange(toValue(next));
  }

  function setTime(part: "hour" | "minute", nextValue: number) {
    const next = selected ? new Date(selected) : new Date();
    next.setSeconds(0, 0);
    if (part === "hour") next.setHours(nextValue);
    else next.setMinutes(nextValue);
    onChange(toValue(next));
  }

  const days = calendarDays(visibleMonth);
  const today = new Date();

  const popover = open && placement ? (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={dateOnly ? "Choose date" : "Choose date and time"}
      className="bp-date-time-popover fixed z-[200] overflow-y-auto overscroll-contain rounded-xl border border-[#dfe3e9] bg-white p-3 shadow-[0_18px_45px_rgba(20,31,51,0.18)]"
      style={{
        top: placement.top,
        left: placement.left,
        width: placement.width,
        maxHeight: placement.maxHeight,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          aria-label="Previous month"
          onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
          className="grid h-8 w-8 place-items-center rounded-lg text-[#5d6673] transition-colors hover:bg-[#f2f5f9] hover:text-[#172033]"
        >
          <ChevronLeft size={17} />
        </button>
        <p aria-live="polite" className="text-[13px] font-semibold text-[#172033]">
          {MONTHS[visibleMonth.getMonth()]} {visibleMonth.getFullYear()}
        </p>
        <button
          type="button"
          aria-label="Next month"
          onClick={() => setVisibleMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
          className="grid h-8 w-8 place-items-center rounded-lg text-[#5d6673] transition-colors hover:bg-[#f2f5f9] hover:text-[#172033]"
        >
          <ChevronRight size={17} />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 text-center">
        {WEEKDAYS.map((day) => (
          <span key={day} className="py-1 text-[10px] font-semibold uppercase tracking-wide text-[#8a93a3]">{day}</span>
        ))}
        {days.map((day) => {
          const isSelected = selected ? sameDay(day, selected) : false;
          const isToday = sameDay(day, today);
          const inMonth = day.getMonth() === visibleMonth.getMonth();
          return (
            <button
              key={day.toISOString()}
              type="button"
              aria-label={day.toLocaleDateString("en-IN", { dateStyle: "long" })}
              aria-pressed={isSelected}
              onClick={() => chooseDay(day)}
              className={`mx-auto grid h-8 w-8 place-items-center rounded-lg text-[11px] font-medium transition-colors ${
                isSelected
                  ? "bg-[#315c9f] font-semibold text-white shadow-sm hover:bg-[#244f8e]"
                  : inMonth
                    ? "text-[#263247] hover:bg-[#edf3fb] hover:text-[#244f8e]"
                    : "text-[#b7bdc7] hover:bg-[#f5f7fa]"
              } ${isToday && !isSelected ? "ring-1 ring-inset ring-[#8aaad6]" : ""}`}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>

      {!dateOnly ? <div className="mt-3 flex items-center gap-2 border-t border-[#edf0f3] pt-3">
        <Clock3 size={15} className="shrink-0 text-[#687384]" />
        <span className="mr-auto text-[11px] font-semibold text-[#344054]">Time</span>
        <select
          aria-label="Hour"
          value={selected?.getHours() ?? 9}
          onChange={(event) => setTime("hour", Number(event.target.value))}
          className="h-8 rounded-lg border border-[#dfe3e9] bg-white px-2 text-[11px] font-medium text-[#263247] outline-none focus:border-[#315c9f]"
        >
          {HOURS.map((hour) => <option key={hour} value={hour}>{pad(hour)}</option>)}
        </select>
        <span className="text-[#8a93a3]">:</span>
        <select
          aria-label="Minute"
          value={selected?.getMinutes() ?? 0}
          onChange={(event) => setTime("minute", Number(event.target.value))}
          className="h-8 rounded-lg border border-[#dfe3e9] bg-white px-2 text-[11px] font-medium text-[#263247] outline-none focus:border-[#315c9f]"
        >
          {MINUTES.map((minute) => <option key={minute} value={minute}>{pad(minute)}</option>)}
        </select>
      </div> : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => { onChange(""); close(true); }}
          disabled={!value}
          className="rounded-lg px-2.5 py-2 text-[11px] font-semibold text-[#687384] hover:bg-[#f4f6f8] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear
        </button>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              now.setSeconds(0, 0);
              onChange(toValue(now, dateOnly));
              setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
              if (dateOnly) close(true);
            }}
            className="rounded-lg px-2.5 py-2 text-[11px] font-semibold text-[#315c9f] hover:bg-[#edf3fb]"
          >
            {dateOnly ? "Today" : "Now"}
          </button>
          {!dateOnly ? <button
            type="button"
            onClick={() => close(true)}
            className="rounded-lg bg-[#172033] px-3 py-2 text-[11px] font-semibold text-white hover:bg-[#263247]"
          >
            Done
          </button> : null}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        id={controlId}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-describedby={ariaDescribedBy}
        data-invalid={invalid || undefined}
        data-required={required || undefined}
        onClick={() => open ? close() : openPicker()}
        className={`flex w-full items-center gap-2 text-left enabled:cursor-pointer ${value ? "pr-9" : ""} ${className} ${invalid ? "border-[#d92d20] focus:border-[#d92d20]" : "enabled:hover:border-[#a9bdd9] enabled:hover:bg-[#f8faff]"}`}
      >
        <CalendarDays size={15} className={`shrink-0 ${value ? "text-[#315c9f]" : "text-[#8a93a3]"}`} />
        <span className={`min-w-0 flex-1 truncate ${value ? "text-[#172033]" : "text-[#98a0ae]"}`}>
          {displayValue(value, dateOnly) || placeholder || (dateOnly ? "Select date" : "Select date and time")}
        </span>
      </button>
      {value ? (
        <button
          type="button"
          aria-label={dateOnly ? "Clear date" : "Clear date and time"}
          disabled={disabled}
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-[#8a93a3] hover:bg-[#eef1f5] hover:text-[#344054] disabled:opacity-50"
        >
          <X size={13} />
        </button>
      ) : null}
      {typeof document !== "undefined" ? createPortal(popover, document.body) : null}
    </div>
  );
}

export function DatePicker(props: Readonly<Omit<DateTimePickerProps, "dateOnly">>) {
  return <DateTimePicker {...props} dateOnly />;
}
