// ============================================================================
// Class-level helpers — single source of truth for "what class is this?"
// and "does CDC apply here?"
//
// Both helpers are pure, dependency-free, and safe to call during render.
// Extracted from three inline copies in the student-evaluation page tree
// during the Deviation 002 (class 1-5 eligibility filter) change. The
// body of `extractClassLevel` is verbatim from those copies — not
// modified — so call-site behavior is byte-identical.
// ============================================================================

/**
 * Pull the class number out of a free-text `Class.name`.
 *
 * Returns the first integer 1..12 found in the name, or `null` when:
 *   • the name is empty / nullish
 *   • no digit run is found ("Class IV" Roman numerals — out of scope;
 *     "Nursery", "ECE", etc. — out of scope until ECD curriculum)
 *   • the parsed integer falls outside the school-year band (1..12)
 *
 * The regex below is INTENTIONALLY non-anchored. The earlier version
 * (`\b(\d{1,2})\b`) required word boundaries on BOTH sides of the
 * digit run, which silently dropped common inline-section names like
 * "Class 4B" (no boundary between `4` and `B` — both are word chars).
 * Schools naming classes this way had their CDC-eligible classes
 * hidden from the home screen with a misleading "not eligible"
 * message; see lib/__tests__/class-level.test.ts for the pinned
 * cases.
 *
 * Trade-off: a pathological name like "Class 123" now parses as 12
 * (greedy 2-digit match from the start of the digit run) rather than
 * returning null. The downstream `isCdcEligibleClassLevel(12)` still
 * returns false, so the user-facing impact is the same in practice —
 * a misnamed class stays hidden. The real fix is a `Class.level`
 * integer column on the backend, queued in pre-pilot blockers.
 */
export function extractClassLevel(
  name: string | null | undefined,
): number | null {
  if (!name) return null;
  const m = name.match(/(\d{1,2})/);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  if (!Number.isInteger(n) || n < 1 || n > 12) return null;
  return n;
}

/**
 * CDC continuous evaluation applies only to classes 1-5.
 * Pre-primary (level 0 or null), unparseable class names, and
 * classes 6+ are all excluded.
 *
 * ECD (early childhood development) support is deferred to v1.5+
 * because it uses a separate curriculum with different outcomes
 * that aren't yet seeded.
 *
 * Defensive against NaN / non-integer numerics: `>= 1 && <= 5` would
 * also reject NaN (NaN comparisons return false), but the explicit
 * `Number.isInteger` check below documents intent and survives a
 * future caller that passes e.g. a fractional class level.
 */
export function isCdcEligibleClassLevel(level: number | null): boolean {
  if (level === null) return false;
  if (!Number.isInteger(level)) return false;
  return level >= 1 && level <= 5;
}
