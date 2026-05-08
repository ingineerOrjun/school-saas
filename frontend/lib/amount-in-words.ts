// ---------------------------------------------------------------------------
// Amount-in-words — South-Asian (lakh / crore) numbering.
//
// Client-side mirror of the canonical implementation at
// `backend/src/common/money/amount-in-words.ts`. Kept logically
// identical (different quote style only) so the words shown on the
// printed receipt match what any future server-side rendering produces.
//
// Tests live next to the backend copy (`amount-in-words.spec.ts`) — if
// you change behaviour here, port the change there AND update the tests.
//
// Why Indian numbering and not Western (thousand / million / billion)?
//   • The app is Bikram-Sambat aware, default currency is Nepali Rupee.
//   • Schools issuing these receipts are in Nepal/India; the parent
//     reading the slip parses "lakh" instantly and "million" not at all.
//
// Decimal policy
//   • Inputs are ALWAYS rounded to 2dp before conversion. A receipt
//     printed as "Rs. 100.50" must read "Rupees One Hundred and Fifty
//     Paisa Only" — never "…Forty Nine Paisa…" because of float drift.
//   • Negative amounts are prefixed with "Negative ". Refund slips use
//     the absolute value at the call site (the receipt template adds
//     "Refund of " separately) so the words read cleanly either way.
//
// Range: handles up to 99 crore (9,99,99,99,999.99). Above that we fall
// back to numerals because the higher BS place values ("kharab", "neel")
// aren't recognised by everyday readers.
// ---------------------------------------------------------------------------

const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];

const TENS = [
  "",
  "",
  "Twenty",
  "Thirty",
  "Forty",
  "Fifty",
  "Sixty",
  "Seventy",
  "Eighty",
  "Ninety",
];

/** 0–99 → words. Empty string for 0 so callers can omit zero chunks. */
function twoDigitWords(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return ones === 0 ? TENS[tens] : `${TENS[tens]} ${ONES[ones]}`;
}

/** 0–999 → words, with the "hundred" join. */
function threeDigitWords(n: number): string {
  if (n === 0) return "";
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  const head = hundreds > 0 ? `${ONES[hundreds]} Hundred` : "";
  const tail = twoDigitWords(rest);
  if (head && tail) return `${head} ${tail}`;
  return head || tail;
}

/**
 * Convert a non-negative integer to South-Asian words.
 *
 *   1,23,45,678  →  "One Crore Twenty Three Lakh Forty Five Thousand
 *                    Six Hundred Seventy Eight"
 */
function integerToWords(n: number): string {
  if (n === 0) return "";

  const crore = Math.floor(n / 10_000_000);
  const lakh = Math.floor((n % 10_000_000) / 100_000);
  const thousand = Math.floor((n % 100_000) / 1_000);
  const hundred = n % 1_000;

  const parts: string[] = [];
  if (crore > 0) parts.push(`${integerToWords(crore)} Crore`);
  if (lakh > 0) parts.push(`${twoDigitWords(lakh)} Lakh`);
  if (thousand > 0) parts.push(`${twoDigitWords(thousand)} Thousand`);
  if (hundred > 0) parts.push(threeDigitWords(hundred));

  return parts.filter(Boolean).join(" ");
}

export interface AmountInWordsOptions {
  /** Currency name to prepend ("Rupees" by default). Empty string skips. */
  currency?: string;
  /** Subunit name ("Paisa" by default). Used only when input has decimals. */
  subunit?: string;
  /** Trailing word ("Only" by default). */
  suffix?: string;
}

/**
 * Convert a currency amount to a printable phrase. See the file header
 * for the contract; tests at `backend/src/common/money/amount-in-words.spec.ts`.
 */
export function amountInWords(
  amount: number,
  options: AmountInWordsOptions = {},
): string {
  const { currency = "Rupees", subunit = "Paisa", suffix = "Only" } = options;

  if (!Number.isFinite(amount)) return "—";

  const sign = amount < 0 ? "Negative " : "";
  const abs = Math.abs(amount);

  // Round to 2dp to dodge floating-point drift like 0.1 + 0.2.
  const rounded = Math.round(abs * 100) / 100;
  const rupees = Math.floor(rounded);
  const paisa = Math.round((rounded - rupees) * 100);

  // Out-of-range guard. 99 crore = 9.9 × 10^9.
  if (rupees > 99_99_99_99_999) {
    return `${currency} ${rounded.toLocaleString("en-IN")} ${suffix}`.trim();
  }

  const rupeeWords = rupees === 0 ? "Zero" : integerToWords(rupees);
  const paisaWords = paisa > 0 ? twoDigitWords(paisa) : "";

  const head = currency ? `${currency} ${rupeeWords}` : rupeeWords;
  const tail = paisaWords ? ` and ${paisaWords} ${subunit}` : "";

  return `${sign}${head}${tail} ${suffix}`.trim();
}
