import {
  applyRatingToCells,
  EMPTY_CELL,
  getDisplayedAfterSupport,
  getEffectiveRating,
  type CellState,
} from "../_lib/rating-cell";

// ============================================================================
// rating-cell — pure helper regression tests (Deviation 001 rewrite).
//
// Field renames since the previous version:
//   • `rating`            → `regular`
//   • `afterSupportRating` → `afterSupport`
//   • `syncStatus`        → `regularSyncStatus`
//   • `afterSupportSyncStatus` / `pulseKey` unchanged
//
// The previous `applyAfterSupportRatingToCells` helper is gone; the
// new `applyRatingToCells` takes a `phase` argument that picks which
// pair of fields to update. Tests below cover both phase paths plus
// the new `getEffectiveRating` / `getDisplayedAfterSupport` read views
// that drive the row-color logic and the ghosted AFTER_SUPPORT
// rendering.
//
// Bug-fix invariants from earlier sessions still pinned:
//   • Cell-not-yet-seeded race: helpers default to EMPTY_CELL
//   • setState bail safety: a no-op call returns a NEW top-level
//     object but reuses other students' cells by reference (covered
//     in seed-cells.test.ts; this file covers per-tap mutations)
// ============================================================================

function cell(overrides: Partial<CellState> = {}): CellState {
  return { ...EMPTY_CELL, ...overrides };
}

describe("applyRatingToCells (phase-parameterized)", () => {
  it("creates a brand-new cell when the student has no existing entry (the unseeded-race fix)", () => {
    const next = applyRatingToCells({}, "student-x", "REGULAR", 3, "pending");

    expect(next).toEqual({
      "student-x": {
        regular: 3,
        afterSupport: null,
        regularSyncStatus: "pending",
        afterSupportSyncStatus: "synced",
        pulseKey: 1,
      },
    });
  });

  it("REGULAR tap updates only the regular pair, preserves afterSupport pair", () => {
    const cells = {
      "s-1": cell({
        regular: 2,
        regularSyncStatus: "synced",
        afterSupport: 4,
        afterSupportSyncStatus: "synced",
        pulseKey: 5,
      }),
    };
    const next = applyRatingToCells(cells, "s-1", "REGULAR", 3, "pending");

    expect(next["s-1"]).toEqual({
      regular: 3, // updated
      regularSyncStatus: "pending", // updated
      afterSupport: 4, // preserved
      afterSupportSyncStatus: "synced", // preserved
      pulseKey: 6, // bumped
    });
  });

  it("AFTER_SUPPORT tap updates only the afterSupport pair, preserves regular pair", () => {
    const cells = {
      "s-1": cell({
        regular: 2,
        regularSyncStatus: "synced",
        afterSupport: null,
        afterSupportSyncStatus: "synced",
        pulseKey: 5,
      }),
    };
    const next = applyRatingToCells(
      cells,
      "s-1",
      "AFTER_SUPPORT",
      3,
      "pending",
    );

    expect(next["s-1"]).toEqual({
      regular: 2, // preserved
      regularSyncStatus: "synced", // preserved
      afterSupport: 3, // updated
      afterSupportSyncStatus: "pending", // updated
      pulseKey: 6, // bumped
    });
  });

  it("bumps pulseKey even on idempotent re-tap of the same value", () => {
    const cells = { "s-1": cell({ regular: 4, pulseKey: 7 }) };
    const next = applyRatingToCells(cells, "s-1", "REGULAR", 4, "pending");
    expect(next["s-1"].regular).toBe(4);
    expect(next["s-1"].pulseKey).toBe(8);
  });

  it("does NOT mutate the input cells object (React state immutability)", () => {
    const cells = { "s-1": cell({ regular: 2 }) };
    const snapshot = JSON.stringify(cells);
    const next = applyRatingToCells(cells, "s-1", "REGULAR", 3, "pending");
    expect(JSON.stringify(cells)).toBe(snapshot);
    expect(next).not.toBe(cells);
  });

  it("preserves other students' cells by reference (no needless deep clone)", () => {
    const sharedCell = cell({ regular: 4 });
    const cells = { "s-1": sharedCell, "s-2": cell() };
    const next = applyRatingToCells(cells, "s-2", "REGULAR", 1, "pending");
    expect(next["s-1"]).toBe(sharedCell);
  });

  // -------------------------------------------------------------------------
  // syncStatus state machine — phase-independent
  // -------------------------------------------------------------------------
  describe("syncStatus state machine", () => {
    it("transitions REGULAR through pending → synced (success path)", () => {
      const afterTap = applyRatingToCells({}, "s-1", "REGULAR", 3, "pending");
      expect(afterTap["s-1"].regularSyncStatus).toBe("pending");
      const afterConfirm = applyRatingToCells(
        afterTap,
        "s-1",
        "REGULAR",
        3,
        "synced",
      );
      expect(afterConfirm["s-1"].regularSyncStatus).toBe("synced");
      expect(afterConfirm["s-1"].regular).toBe(3);
    });

    it("transitions REGULAR through pending → failed (WhatsApp attempt-preserved)", () => {
      const afterTap = applyRatingToCells({}, "s-1", "REGULAR", 4, "pending");
      const afterReject = applyRatingToCells(
        afterTap,
        "s-1",
        "REGULAR",
        4,
        "failed",
      );
      expect(afterReject["s-1"].regular).toBe(4); // attempted value preserved
      expect(afterReject["s-1"].regularSyncStatus).toBe("failed");
    });

    it("per-phase failure is independent — failed AFTER_SUPPORT leaves REGULAR's synced state alone", () => {
      const start = applyRatingToCells({}, "s-1", "REGULAR", 3, "synced");
      const afterFailedAS = applyRatingToCells(
        start,
        "s-1",
        "AFTER_SUPPORT",
        4,
        "failed",
      );
      expect(afterFailedAS["s-1"].regular).toBe(3);
      expect(afterFailedAS["s-1"].regularSyncStatus).toBe("synced");
      expect(afterFailedAS["s-1"].afterSupport).toBe(4);
      expect(afterFailedAS["s-1"].afterSupportSyncStatus).toBe("failed");
    });
  });
});

describe("EMPTY_CELL", () => {
  it("has both phase fields null and both sync statuses 'synced'", () => {
    // Guard against a future field being added to CellState without
    // EMPTY_CELL being updated — would re-introduce the undefined-
    // access class of bug for the new field.
    expect(EMPTY_CELL).toEqual({
      regular: null,
      afterSupport: null,
      regularSyncStatus: "synced",
      afterSupportSyncStatus: "synced",
      pulseKey: 0,
    });
  });
});

// ============================================================================
// getEffectiveRating + getDisplayedAfterSupport — new read views.
//
// These two helpers are the single source of truth for:
//   • Row color + accessibility icon (effective rating)
//   • Ghosted AFTER_SUPPORT button rendering (displayed AS value +
//     isGhosted flag)
//
// The row component and the report-card calculation MUST agree on
// "what value matters here" — these helpers enforce that.
// ============================================================================

describe("getEffectiveRating", () => {
  it("returns afterSupport when explicitly set, overriding regular", () => {
    expect(getEffectiveRating(cell({ regular: 2, afterSupport: 4 }))).toBe(4);
  });

  it("returns regular when afterSupport is null", () => {
    expect(getEffectiveRating(cell({ regular: 3, afterSupport: null }))).toBe(3);
  });

  it("returns null when neither phase is rated", () => {
    expect(getEffectiveRating(cell({ regular: null, afterSupport: null }))).toBeNull();
  });

  it("returns null defensively when the cell is undefined (unseeded row)", () => {
    expect(getEffectiveRating(undefined)).toBeNull();
  });
});

describe("getDisplayedAfterSupport", () => {
  it("returns ghosted=true mirroring regular when afterSupport is null and regular is set", () => {
    expect(
      getDisplayedAfterSupport(cell({ regular: 3, afterSupport: null })),
    ).toEqual({ value: 3, isGhosted: true });
  });

  it("returns ghosted=false with the actual value when afterSupport is explicitly set", () => {
    expect(
      getDisplayedAfterSupport(cell({ regular: 2, afterSupport: 4 })),
    ).toEqual({ value: 4, isGhosted: false });
  });

  it("returns null value when neither phase is rated (column renders empty buttons)", () => {
    expect(
      getDisplayedAfterSupport(cell({ regular: null, afterSupport: null })),
    ).toEqual({ value: null, isGhosted: false });
  });

  it("returns null defensively when the cell is undefined (unseeded row)", () => {
    expect(getDisplayedAfterSupport(undefined)).toEqual({
      value: null,
      isGhosted: false,
    });
  });
});
