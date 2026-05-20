import {
  applySeedToCells,
  EMPTY_CELL,
  type CellState,
  type SeedableRecord,
  type SeedableStudent,
} from "../_lib/rating-cell";

// ============================================================================
// applySeedToCells — pure helper regression tests.
//
// Pins the fix for the Session 6a infinite re-render loop. The
// previous inline seed effect always returned `{ ...prev }` from
// setCells, even when nothing new was seeded. Combined with an
// unstable `records.byStudentId` Map identity from the parent hook,
// the new-but-equivalent state object re-triggered the effect every
// render, forever.
//
// The helper below is now the single source of truth for the seed
// step. Any future refactor that loses the no-change-returns-prev
// property will fail the first test in this file.
// ============================================================================

const STUDENT_A: SeedableStudent = { id: "s-a" };
const STUDENT_B: SeedableStudent = { id: "s-b" };
const STUDENT_C: SeedableStudent = { id: "s-c" };

const OUTCOME_ID = "outcome-x";

function recordsMap(
  entries: Array<[string, SeedableRecord[]]>,
): Map<string, SeedableRecord[]> {
  return new Map(entries);
}

describe("applySeedToCells — no-change bail (loop fix)", () => {
  it("returns next === prev when no students need seeding (the load-bearing invariant)", () => {
    // This is the exact scenario that drove the loop: re-rendering
    // when every student is already seeded. The helper must return
    // the same object reference so React's setState bails on
    // identical state.
    const prev: Record<string, CellState> = {
      "s-a": {
        regular: 3,
        afterSupport: null,
        pulseKey: 0,
        regularSyncStatus: "synced",
        afterSupportSyncStatus: "synced",
      },
      "s-b": {
        regular: 4,
        afterSupport: null,
        pulseKey: 0,
        regularSyncStatus: "synced",
        afterSupportSyncStatus: "synced",
      },
    };
    const seeded = new Set(["s-a", "s-b"]);

    const result = applySeedToCells(
      prev,
      [STUDENT_A, STUDENT_B],
      recordsMap([
        ["s-a", [{ phase: "REGULAR", outcomeId: OUTCOME_ID, rating: 3 }]],
        ["s-b", [{ phase: "REGULAR", outcomeId: OUTCOME_ID, rating: 4 }]],
      ]),
      OUTCOME_ID,
      seeded,
    );

    // SAME REFERENCE — this is what makes React.setState bail.
    expect(result.next).toBe(prev);
    expect(result.newlySeeded).toEqual([]);
  });

  it("returns next === prev when students need seeding but their records haven't loaded yet", () => {
    // Records map is empty (no per-student query has resolved). The
    // helper must NOT pre-seed the students into seededFor — that's
    // the secondary bug from the previous inline effect: it added
    // s-a/s-b to seededFor with empty `?? []` records, then locked
    // them out of future seeding when real data arrived.
    const prev: Record<string, CellState> = {};

    const result = applySeedToCells(
      prev,
      [STUDENT_A, STUDENT_B],
      recordsMap([]),
      OUTCOME_ID,
      new Set(),
    );

    expect(result.next).toBe(prev);
    expect(result.newlySeeded).toEqual([]);
  });

  it("seeds only the students whose records have arrived, leaves the rest for later", () => {
    // Partial fan-out resolve — student A has data, student B
    // doesn't yet. A should be seeded, B should be left alone so
    // it can be seeded when its query lands.
    const prev: Record<string, CellState> = {};

    const result = applySeedToCells(
      prev,
      [STUDENT_A, STUDENT_B],
      recordsMap([
        ["s-a", [{ phase: "REGULAR", outcomeId: OUTCOME_ID, rating: 3 }]],
        // s-b absent from the map — query still in flight.
      ]),
      OUTCOME_ID,
      new Set(),
    );

    expect(result.next).not.toBe(prev); // changed
    expect(result.newlySeeded).toEqual(["s-a"]);
    expect(result.next["s-a"]).toEqual({
      regular: 3,
      afterSupport: null,
      pulseKey: 0,
      regularSyncStatus: "synced",
      afterSupportSyncStatus: "synced",
    });
    expect("s-b" in result.next).toBe(false);
  });

  it("seeds AFTER_SUPPORT alone when only an AFTER_SUPPORT record exists (Deviation 001)", () => {
    // Pre-Deviation 001, an AFTER_SUPPORT row could only exist with
    // a matching REGULAR ≤ 2 row. The precondition is gone, so a
    // student may legitimately have JUST an AFTER_SUPPORT record
    // (e.g. teacher tapped the AFTER_SUPPORT column for a student
    // they hadn't given a REGULAR rating to yet). The seed helper
    // must populate `afterSupport` from such a record while leaving
    // `regular` null — and `getEffectiveRating` will then surface
    // the AFTER_SUPPORT value as the row's effective rating.
    const result = applySeedToCells(
      {},
      [STUDENT_A],
      recordsMap([
        [
          "s-a",
          [{ phase: "AFTER_SUPPORT", outcomeId: OUTCOME_ID, rating: 4 }],
        ],
      ]),
      OUTCOME_ID,
      new Set(),
    );

    expect(result.next["s-a"]).toEqual({
      regular: null,
      afterSupport: 4,
      pulseKey: 0,
      regularSyncStatus: "synced",
      afterSupportSyncStatus: "synced",
    });
  });

  it("seeds AFTER_SUPPORT alongside REGULAR when both records are present", () => {
    const result = applySeedToCells(
      {},
      [STUDENT_A],
      recordsMap([
        [
          "s-a",
          [
            { phase: "REGULAR", outcomeId: OUTCOME_ID, rating: 2 },
            { phase: "AFTER_SUPPORT", outcomeId: OUTCOME_ID, rating: 3 },
          ],
        ],
      ]),
      OUTCOME_ID,
      new Set(),
    );

    expect(result.next["s-a"]).toEqual({
      regular: 2,
      afterSupport: 3,
      pulseKey: 0,
      regularSyncStatus: "synced",
      afterSupportSyncStatus: "synced",
    });
  });

  it("ignores records that belong to a different outcome", () => {
    // The fan-out hook returns ALL records for the student in the
    // current session — not just for this outcome. We must filter
    // by outcomeId so we don't seed cells with another outcome's
    // rating.
    const result = applySeedToCells(
      {},
      [STUDENT_A],
      recordsMap([
        [
          "s-a",
          [
            { phase: "REGULAR", outcomeId: "outcome-OTHER", rating: 4 },
          ],
        ],
      ]),
      OUTCOME_ID, // looking for this outcome, but only outcome-OTHER is present
      new Set(),
    );

    // Student appears in newlySeeded — we DID seed their cell, just
    // with null values (records present but none matched).
    expect(result.newlySeeded).toEqual(["s-a"]);
    expect(result.next["s-a"]).toEqual(EMPTY_CELL);
  });

  it("preserves other students' cells by reference (no needless deep clone)", () => {
    const sharedCell: CellState = {
      regular: 4,
      afterSupport: null,
      pulseKey: 0,
      regularSyncStatus: "synced",
      afterSupportSyncStatus: "synced",
    };
    const prev: Record<string, CellState> = {
      "s-a": sharedCell,
    };

    const result = applySeedToCells(
      prev,
      [STUDENT_A, STUDENT_B],
      recordsMap([
        ["s-b", [{ phase: "REGULAR", outcomeId: OUTCOME_ID, rating: 1 }]],
      ]),
      OUTCOME_ID,
      new Set(["s-a"]),
    );

    expect(result.next).not.toBe(prev);
    // s-a wasn't touched — same object reference. Downstream React.memo
    // components rendering that row don't re-render.
    expect(result.next["s-a"]).toBe(sharedCell);
  });

  it("does NOT mutate the input cells object", () => {
    const prev: Record<string, CellState> = {};
    const snapshot = JSON.stringify(prev);
    applySeedToCells(
      prev,
      [STUDENT_C],
      recordsMap([
        ["s-c", [{ phase: "REGULAR", outcomeId: OUTCOME_ID, rating: 1 }]],
      ]),
      OUTCOME_ID,
      new Set(),
    );
    expect(JSON.stringify(prev)).toBe(snapshot);
  });
});
