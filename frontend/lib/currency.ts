// ---------------------------------------------------------------------------
// Currency formatting — single source of truth.
//
// EVERY money-rendering surface in the app calls into this module. No
// component should hand-roll `toLocaleString` for currency, and no
// component should hard-code "$", "Rs.", or any other symbol — the
// codebase has been bitten before by mixed-currency bugs (USD on the
// dashboard, blank elsewhere) and the only way to keep them out is one
// chokepoint.
//
// Why these defaults
//   • Symbol `रु.` — the conventional Devanagari abbreviation for the
//     Nepali Rupee. Recognisable to the audience; banks, schools, and
//     bills all use this glyph.
//   • Locale `en-IN` — South-Asian grouping (1,23,456.78) which the
//     audience parses naturally. The Latin-script locale keeps numbers
//     legible to bilingual readers without forcing Devanagari numerals.
//   • Decimal policy — the public API offers two functions so the call
//     site picks: `formatCurrency` (always 2dp) for receipts and ledgers
//     where paisa precision matters; `formatCurrencyShort` (no decimals)
//     for dashboard cards and at-a-glance summaries.
//
// Database stores `amount: number` only. The symbol lives in the UI.
// ---------------------------------------------------------------------------

/**
 * App-wide currency configuration. Single source of truth — change
 * here and every formatter follows. Exported for the rare component
 * that needs the raw symbol (e.g. an input adornment "रु. [____]").
 */
export const CURRENCY = {
  /** Display symbol prefixed to every formatted amount. */
  symbol: "रु.",
  /**
   * Locale tag passed to `toLocaleString`. `en-IN` gives South-Asian
   * digit grouping (1,23,456.78) without forcing Devanagari numerals.
   */
  locale: "en-IN",
  /** ISO-4217 code, in case a caller ever needs it for export/CSV. */
  code: "NPR",
} as const;

/**
 * Format a money amount with full precision (2 decimal places).
 *
 *   formatCurrency(5000)    → "रु. 5,000.00"
 *   formatCurrency(5000.5)  → "रु. 5,000.50"
 *   formatCurrency(0)       → "रु. 0.00"
 *
 * Use this anywhere paisa precision matters — receipts, fee ledgers,
 * payment history, anything an auditor might read.
 */
export function formatCurrency(amount: number): string {
  if (!Number.isFinite(amount)) return `${CURRENCY.symbol} —`;
  // Round to 2dp at the boundary to defeat float drift (0.1 + 0.2
  // territory). Without this the locale formatter happily renders
  // 0.30000000000000004 as "0.30" — but other consumers of the same
  // amount might see the unrounded value and disagree.
  const rounded = Math.round(amount * 100) / 100;
  const body = rounded.toLocaleString(CURRENCY.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${CURRENCY.symbol} ${body}`;
}

/**
 * Format a money amount without decimals — for compact, at-a-glance
 * surfaces (dashboard tiles, list-row totals).
 *
 *   formatCurrencyShort(5000.5)  → "रु. 5,001"
 *   formatCurrencyShort(0)       → "रु. 0"
 *
 * Rounds to the nearest whole rupee on display; the underlying
 * `amount` is unchanged. Don't use this on receipts — paisa precision
 * matters there.
 */
export function formatCurrencyShort(amount: number): string {
  if (!Number.isFinite(amount)) return `${CURRENCY.symbol} —`;
  const body = Math.round(amount).toLocaleString(CURRENCY.locale, {
    maximumFractionDigits: 0,
  });
  return `${CURRENCY.symbol} ${body}`;
}

/**
 * Numeric-only formatting — same grouping as `formatCurrency` but
 * without the symbol. Use when a column header or label already
 * carries the symbol (e.g. "Amount (रु.)" → row values are bare).
 *
 *   formatAmount(5000.5)  → "5,000.50"
 */
export function formatAmount(amount: number): string {
  if (!Number.isFinite(amount)) return "—";
  const rounded = Math.round(amount * 100) / 100;
  return rounded.toLocaleString(CURRENCY.locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
