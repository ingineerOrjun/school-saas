import {
  extractClassLevel,
  isCdcEligibleClassLevel,
} from "../class-level";

// ============================================================================
// class-level helpers — Deviation 002 tests.
//
// `isCdcEligibleClassLevel` is the source of truth for "is this class
// in CDC scope?" Three pages depend on it (the home screen filter +
// two defense-in-depth guards on deep-link entry). A future change
// that loosens the 1-5 range would propagate to all three; locking
// the boundary cases here means that change ALSO has to be a
// deliberate test edit.
//
// `extractClassLevel` was deduped from three inline copies into
// lib/class-level.ts as part of this same change. The tests below
// pin its current behavior verbatim — the body wasn't modified, but
// future cleanup of the known parser fragility (Roman numerals, etc.)
// should land alongside additions here, not silent edits.
// ============================================================================

describe("isCdcEligibleClassLevel", () => {
  it("returns true for the in-scope class levels 1, 2, 3, 4, 5", () => {
    for (const level of [1, 2, 3, 4, 5]) {
      expect(isCdcEligibleClassLevel(level)).toBe(true);
    }
  });

  it("returns false for level 0 (pre-primary / ECD — deferred to v1.5+)", () => {
    expect(isCdcEligibleClassLevel(0)).toBe(false);
  });

  it("returns false for null (extractClassLevel couldn't parse the class name)", () => {
    expect(isCdcEligibleClassLevel(null)).toBe(false);
  });

  it("returns false for class 6 and above (traditional grading)", () => {
    for (const level of [6, 7, 8, 9, 10, 11, 12]) {
      expect(isCdcEligibleClassLevel(level)).toBe(false);
    }
  });

  it("returns false for negative integers (defensive)", () => {
    expect(isCdcEligibleClassLevel(-1)).toBe(false);
  });

  it("returns false for NaN (defensive against a future parser that misfires)", () => {
    // Number-typed but not integer-like — the boundary check
    // `level >= 1 && level <= 5` returns false for NaN on its own
    // (any comparison with NaN is false), but the explicit
    // Number.isInteger guard documents the intent and protects
    // against a future caller that relies on a different range
    // operator.
    expect(isCdcEligibleClassLevel(Number.NaN)).toBe(false);
  });

  it("returns false for fractional / non-integer numerics (defensive)", () => {
    expect(isCdcEligibleClassLevel(3.5)).toBe(false);
    expect(isCdcEligibleClassLevel(1.0001)).toBe(false);
  });
});

describe("extractClassLevel (carried verbatim from the three inline copies)", () => {
  it("parses 'Class 4' to 4 (digit surrounded by word boundaries)", () => {
    expect(extractClassLevel("Class 4")).toBe(4);
    expect(extractClassLevel("Class 4 — Section A")).toBe(4);
  });

  it("parses 'Grade 5' to 5", () => {
    expect(extractClassLevel("Grade 5")).toBe(5);
  });

  // -------------------------------------------------------------------------
  // Inline-section parsing (post-fix behavior).
  //
  // The regex was changed from `\b(\d{1,2})\b` to `(\d{1,2})` to
  // unblock inline-section names like "Class 4B". The word-boundary
  // anchor was too strict: it required a non-word char on BOTH sides
  // of the digit run, so "4B" failed because `B` is a word char with
  // no boundary between it and `4`. Schools using this naming
  // convention had their eligible classes silently hidden with a
  // misleading "not eligible" message on direct URL.
  //
  // Non-anchored is the safer choice because the failure mode of
  // "fails-closed silently hides eligible classes" is worse than
  // rare false-positives. The pre-pilot blockers doc tracks the
  // hypothetical regression case ("Class 123" parses as 12); the
  // downstream eligibility gate happens to also exclude 12, so the
  // user-facing impact is the same in practice.
  // -------------------------------------------------------------------------

  it("parses 'Class 4B' as level 4 (section letter ignored)", () => {
    expect(extractClassLevel("Class 4B")).toBe(4);
  });

  it("parses 'Class 4 Section A' as level 4 (multi-token, first-digit-wins)", () => {
    // Space-separated multi-token names work fine. The regex picks
    // up the first digit run regardless of word-boundary state of
    // the surrounding tokens. "Section A" contributes no digits, so
    // 4 is unambiguous.
    expect(extractClassLevel("Class 4 Section A")).toBe(4);
  });

  it("parses '5अ' as level 5 (Devanagari section letter — digit-led)", () => {
    // Schools localized to Nepali sometimes name sections with
    // Devanagari letters glued to the digit. JavaScript's `\d`
    // matches ASCII 0-9 only, so the digit run is `5` and the
    // Devanagari letter `अ` is just a non-matching adjacent
    // character that the non-anchored regex steps over.
    expect(extractClassLevel("5अ")).toBe(5);
  });

  it("still returns null for purely non-numeric names ('Bal Sreni', 'KG Upper', 'ECE')", () => {
    // Regression guard: the regex relaxation should ONLY change
    // behavior for digit-bearing inputs. Pre-primary / ECE names
    // that don't carry a digit still return null, so the
    // eligibility pipeline keeps excluding them correctly.
    expect(extractClassLevel("Bal Sreni")).toBeNull();
    expect(extractClassLevel("KG Upper")).toBeNull();
    expect(extractClassLevel("ECE")).toBeNull();
  });

  it("returns null for empty / nullish inputs", () => {
    expect(extractClassLevel(null)).toBeNull();
    expect(extractClassLevel(undefined)).toBeNull();
    expect(extractClassLevel("")).toBeNull();
  });

  it("returns null for Roman numerals (known parser limitation)", () => {
    expect(extractClassLevel("Class IV")).toBeNull();
    expect(extractClassLevel("Class XI")).toBeNull();
  });

  it("returns null for names with no digit run at all", () => {
    expect(extractClassLevel("Nursery")).toBeNull();
    expect(extractClassLevel("Kindergarten")).toBeNull();
  });

  it("returns null for integers outside the 1-12 school-year band", () => {
    // The parser's `n < 1 || n > 12` guard rejects integers outside
    // the realistic range — a class named "Class 50" almost
    // certainly means something else (room number? code?) and we
    // refuse to guess.
    expect(extractClassLevel("Class 0")).toBeNull();
    expect(extractClassLevel("Class 13")).toBeNull();
    expect(extractClassLevel("Class 50")).toBeNull();
  });
});

// Composition test — the dominant call shape across the three pages
// is `isCdcEligibleClassLevel(extractClassLevel(name))`. Locking the
// happy + sad paths of the compound expression catches a regression
// in either layer without having to compose mentally at every call
// site.
describe("composition: isCdcEligibleClassLevel(extractClassLevel(name))", () => {
  it("returns true for typical primary class names", () => {
    expect(isCdcEligibleClassLevel(extractClassLevel("Class 4"))).toBe(true);
    expect(
      isCdcEligibleClassLevel(extractClassLevel("Class 4 — Section A")),
    ).toBe(true);
    expect(isCdcEligibleClassLevel(extractClassLevel("Grade 1"))).toBe(true);
  });

  it("parses inline-section class names: '4B' → 4, '5C' → 5, '7A' → 7", () => {
    // Post-regex-fix: the inline-section format that previously
    // silently dropped eligible classes now parses correctly, and
    // the composition with isCdcEligibleClassLevel gives the right
    // answer (Class 4B / 5C → eligible; Class 7A → traditional).
    expect(isCdcEligibleClassLevel(extractClassLevel("Class 4B"))).toBe(true);
    expect(isCdcEligibleClassLevel(extractClassLevel("Class 5C"))).toBe(true);
    expect(isCdcEligibleClassLevel(extractClassLevel("Class 7A"))).toBe(false);
  });

  it("returns false for class 6+ (traditional grading)", () => {
    expect(isCdcEligibleClassLevel(extractClassLevel("Class 7"))).toBe(false);
    expect(isCdcEligibleClassLevel(extractClassLevel("Class 10"))).toBe(false);
  });

  it("returns false for pre-primary / ECD names (parser returns null → ineligible)", () => {
    expect(isCdcEligibleClassLevel(extractClassLevel("Nursery"))).toBe(false);
    expect(isCdcEligibleClassLevel(extractClassLevel("KG"))).toBe(false);
  });

  it("returns false for Roman-numeral class names (parser returns null → ineligible)", () => {
    // Conservative-by-design: better to hide an eligible class than
    // to show an ineligible one. A "Class IV" misparse fails closed.
    expect(isCdcEligibleClassLevel(extractClassLevel("Class IV"))).toBe(false);
  });
});
