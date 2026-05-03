/**
 * Dual-calendar formatting helpers.
 *
 * Storage rule: every date in the database is A.D. (`DateTime` /
 * `DATE`). We never store B.S. — the conversion is purely a display
 * concern. Any user input collected as B.S. converts to A.D. before
 * hitting the backend.
 *
 * Library: `bikram-sambat-js` — supports the standard 1970–2100 AD
 * range (≈ 2026–2156 BS). Out-of-range dates fall back to A.D. only
 * so the UI never renders nonsense.
 */
import { ADToBS, BSToAD } from "bikram-sambat-js";

export type CalendarMode = "bs" | "ad" | "dual";

/**
 * Coerce whatever the caller gave us into a Date. Strings, numbers,
 * and Dates all work; null/undefined/invalid get null back so the
 * call site can short-circuit to an em-dash.
 */
function toDate(input: Date | string | number | null | undefined): Date | null {
  if (input == null || input === "") return null;
  const d = input instanceof Date ? input : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Pads each component of a "YYYY-M-D" → "YYYY-MM-DD". */
function padIso(ymd: string): string {
  const parts = ymd.split("-");
  if (parts.length !== 3) return ymd;
  const [y, m, d] = parts;
  return `${y.padStart(4, "0")}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

/**
 * Convert an A.D. date to a Bikram Sambat YYYY-MM-DD string.
 * Returns null when the date is invalid or outside the conversion
 * library's supported range — callers should fall back to A.D. only.
 */
export function toBSString(
  input: Date | string | number | null | undefined,
): string | null {
  const d = toDate(input);
  if (!d) return null;
  try {
    const raw = ADToBS(d);
    if (!raw || typeof raw !== "string") return null;
    return padIso(raw);
  } catch {
    // The library throws for out-of-range conversions. We swallow and
    // signal "no BS available" so the UI degrades gracefully.
    return null;
  }
}

/**
 * Format an A.D. date as a Bikram Sambat YYYY-MM-DD string. Falls
 * back to the A.D. ISO date if conversion fails — never throws or
 * returns the empty string.
 */
export function formatBS(
  input: Date | string | number | null | undefined,
): string {
  const bs = toBSString(input);
  if (bs) return bs;
  return formatAD(input);
}

/**
 * Format an A.D. date as a YYYY-MM-DD string in the user's local
 * timezone. Centralized so every calendar surface in the app uses
 * the same wall-clock day instead of mixing UTC and local.
 */
export function formatAD(
  input: Date | string | number | null | undefined,
): string {
  const d = toDate(input);
  if (!d) return "—";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * "BS-PRIMARY (AD-SECONDARY)" string for use in plain-text contexts
 * (CSV exports, document footers, etc.). For interactive UI, prefer
 * the `<DualDate>` React component which honors the user's calendar
 * preference and renders a proper hierarchy.
 */
export function formatDual(
  input: Date | string | number | null | undefined,
): string {
  const ad = formatAD(input);
  if (ad === "—") return "—";
  const bs = toBSString(input);
  if (!bs) return ad;
  return `${bs} (${ad})`;
}

/**
 * Format honoring the user's saved calendar preference. Used by
 * `<DualDate>` and any non-React surface that has access to the
 * preference (e.g. document generation called from a page that
 * already read `useCalendarMode`).
 */
export function formatByMode(
  input: Date | string | number | null | undefined,
  mode: CalendarMode,
): string {
  switch (mode) {
    case "bs":
      return formatBS(input);
    case "ad":
      return formatAD(input);
    case "dual":
      return formatDual(input);
  }
}

/**
 * Convert a B.S. YYYY-MM-DD string to A.D. YYYY-MM-DD.
 * Used by date inputs that let the user type a Nepali date — the
 * value still goes to the backend in A.D. form.
 *
 * Returns null on invalid input so the caller can show an inline
 * validation error instead of submitting garbage.
 */
export function bsStringToAd(bs: string): string | null {
  if (!bs || !/^\d{4}-\d{1,2}-\d{1,2}$/.test(bs)) return null;
  try {
    const ad = BSToAD(bs);
    if (!ad || typeof ad !== "string") return null;
    return padIso(ad);
  } catch {
    return null;
  }
}

/**
 * "Today" in A.D. as YYYY-MM-DD (server-stored shape). Wraps the
 * common pattern so callers don't reinvent timezone-safe pad logic.
 */
export function todayAD(): string {
  return formatAD(new Date());
}
