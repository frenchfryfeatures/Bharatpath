/**
 * Shared utility helpers for BharatPath.
 */

import { StyleProp, ViewStyle } from 'react-native';

/** Combine multiple style objects, skipping falsy values. */
export function cn<T = ViewStyle>(
  ...styles: (false | null | undefined | T)[]
): StyleProp<T> {
  const valid = styles.filter(Boolean) as T[];
  return valid.length > 0
    ? valid.length === 1
      ? valid[0]
      : Object.assign({}, ...valid)
    : undefined;
}

/** Clamp a number between min and max. */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Format a number with Indian locale (e.g. 1,25,000). */
export function formatIndianNumber(value: number): string {
  return value.toLocaleString('en-IN');
}

/** Format a monetary value in INR with the ₹ symbol. */
export function formatINR(value: number): string {
  return `₹${formatIndianNumber(value)}`;
}

/** Return initials from a company or person name (max 2 chars). */
export function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/** Convert a hex color (#RRGGBB) to an rgba string with the given alpha. */
export function withAlpha(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Deterministic color pick from a string (for company monogram backgrounds). */
export function pickFromString<T>(str: string, options: T[]): T {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return options[Math.abs(hash) % options.length];
}

// ─── JOB BOARD FORMATTING ─────────────────────────────────────
// Money on the backend is integer paise (minor units). These helpers convert
// paise → display strings for the candidate board. Never send rupees back to
// the API - only paise.

/**
 * Convert integer paise to a compact monthly salary label.
 *
 * `8000000` paise = ₹80,000 → "₹80k". `1500000` → "₹15k". Rounds down to the
 * nearest thousand for the compact form, which is what the board cards show.
 */
export function formatMonthlySalaryPaise(paise: number): string {
  const rupees = Math.floor(paise / 100);
  if (rupees >= 1000) {
    const k = Math.floor(rupees / 1000);
    return `₹${k}k`;
  }
  return `₹${rupees}`;
}

/**
 * Format a salary range from paise into a single compact label.
 *
 * `8000000`–`12000000` → "₹80k–120k". When both ends round to the same compact
 * value, collapses to a single value ("₹80k").
 */
export function formatSalaryRangePaise(
  minMinor: number,
  maxMinor: number,
): string {
  const minLabel = formatMonthlySalaryPaise(minMinor);
  const maxLabel = formatMonthlySalaryPaise(maxMinor);
  if (minLabel === maxLabel) return minLabel;
  if (minLabel.endsWith('k') && maxLabel.endsWith('k')) {
    return `${minLabel}–${maxLabel.replace('₹', '')}`;
  }
  return `${minLabel}–${maxLabel}`;
}

/**
 * Convert a minimum-experience value in months to a short label.
 *
 * `12` → "1 yr", `24` → "2 yrs", `6` → "6 mo", `0`/`null` → "".
 */
export function formatExperienceMonths(
  months: number | null | undefined,
): string {
  if (months == null || months <= 0) return '';
  if (months % 12 === 0) {
    const years = months / 12;
    return years === 1 ? '1 yr' : `${years} yrs`;
  }
  if (months < 12) return `${months} mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem === 0
    ? years === 1
      ? '1 yr'
      : `${years} yrs`
    : `${years} yr ${rem} mo`;
}

/** Work mode → short display label. `null` → ''. */
export function workModeLabel(
  mode: 'ONSITE' | 'HYBRID' | 'REMOTE' | null | undefined,
): string {
  switch (mode) {
    case 'ONSITE':
      return 'Onsite';
    case 'HYBRID':
      return 'Hybrid';
    case 'REMOTE':
      return 'Remote';
    default:
      return '';
  }
}

/**
 * Relative "posted X ago" label from an ISO timestamp.
 *
 * `published_at` is ISO 8601. Returns "Posted today", "Posted yesterday",
 * "Posted N days ago", or a short date for older posts. Falls back to
 * "Recently" if the timestamp is unparseable.
 */
export function formatPostedAgo(iso: string | null | undefined): string {
  if (!iso) return 'Recently';
  const then = new Date(iso);
  const ms = then.getTime();
  if (Number.isNaN(ms)) return 'Recently';
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.floor((now - ms) / dayMs);
  if (diffDays <= 0) return 'Posted today';
  if (diffDays === 1) return 'Posted yesterday';
  if (diffDays < 30) return `Posted ${diffDays} days ago`;
  // Older - short date.
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

/**
 * Format date and time for candidate messages / scheduled interviews.
 *
 * Example: "5 Oct 2026, 12:37 pm" in IST.
 */
export function formatMessageDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'Asia/Kolkata',
    }).format(d);
  } catch {
    const date = d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    });
    const time = d
      .toLocaleTimeString('en-IN', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZone: 'Asia/Kolkata',
      })
      .toLowerCase();
    return `${date}, ${time}`;
  }
}
