// ============================================================================
// Rating-cell local state — the in-component view model for ONE student
// row on the outcome rating screen. Seeded from /continuous-records,
// then mutated optimistically by tap events and reconciled by the
// upsert mutation's onSuccess / onError handlers.
//
// SHAPE CHANGE — Deviation 001 rewrite:
//   • Field renames: `rating` → `regular`, `afterSupportRating` →
//     `afterSupport`, `syncStatus` → `regularSyncStatus`.
//     `afterSupportSyncStatus` / `pulseKey` unchanged.
//   • `applyRatingToCells` now takes a `phase` argument and writes
//     to either the REGULAR pair or the AFTER_SUPPORT pair of fields
//     depending on the value. The previous separate
//     `applyAfterSupportRatingToCells` helper was removed (callers
//     pass `'AFTER_SUPPORT'` here instead).
//   • Two new pure helpers: `getEffectiveRating` and
//     `getDisplayedAfterSupport`. Both are read-only views of a cell
//     and exist so the row component and the row-color logic agree
//     on a single definition.
//
// See backend/docs/cdc-compliance-deviations.md for the why.
//
// BUG-FIX HISTORY (carried through this rewrite):
//   • Cell-not-yet-seeded race: `cells[studentId] ?? EMPTY_CELL`
//     fallback in every helper, never read `.pulseKey` of undefined.
//   • Infinite re-render loop: `applySeedToCells` returns `next ===
//     prev` (same reference) when nothing new can be seeded so
//     setState bails. Defense in depth at the hook layer as well —
//     see lib/continuous-records.ts memoization.
// ============================================================================

/**
 * Per-cell sync state. Drives the row's right-edge status icon:
 *   • 'synced'  — committed on the server (or never tapped). No icon.
 *                 WhatsApp-style "absence is success".
 *   • 'pending' — POST in flight after a tap. Clock icon next to the
 *                 affected button group.
 *   • 'failed'  — last POST attempt rejected. Red retry icon next to
 *                 the affected group. The cell KEEPS the attempted
 *                 rating visible (WhatsApp delivery semantics); the
 *                 retry handler reads the cell's `regular` /
 *                 `afterSupport` to know what to re-POST.
 */
export type CellSyncStatus = "synced" | "pending" | "failed";

export interface CellState {
  /** REGULAR rating — null until the teacher taps something. */
  regular: 1 | 2 | 3 | 4 | null;
  /** AFTER_SUPPORT rating — null until the teacher explicitly taps an
   *  AFTER_SUPPORT button. The displayed-as-ghosted "default to
   *  REGULAR" treatment is purely a render concern; this field stays
   *  null on the server side until an explicit tap (so the database
   *  has no AFTER_SUPPORT row, which is what Deviation 001 hinges on
   *  for audit-trail clarity). */
  afterSupport: 1 | 2 | 3 | 4 | null;
  /** Per-phase sync state — see CellSyncStatus. */
  regularSyncStatus: CellSyncStatus;
  afterSupportSyncStatus: CellSyncStatus;
  /** Bumped on every tap so the CSS pulse animation re-runs even
   *  when the teacher re-taps the same value (idempotent rating). */
  pulseKey: number;
}

/**
 * Empty / default cell. Single source of truth for both:
 *   • the JSX fallback when a row hasn't been seeded yet
 *     (`cells[s.id] ?? EMPTY_CELL`)
 *   • the helper when the user taps a row whose state was never
 *     seeded (the missing-cell race that produced the original
 *     "Cannot read properties of undefined" crash).
 */
export const EMPTY_CELL: CellState = {
  regular: null,
  afterSupport: null,
  regularSyncStatus: "synced",
  afterSupportSyncStatus: "synced",
  pulseKey: 0,
};

// ---------------------------------------------------------------------------
// Read views — getEffectiveRating / getDisplayedAfterSupport.
// ---------------------------------------------------------------------------

/**
 * Effective rating = the value that should drive the row's color
 * accent + accessibility icon. Per Deviation 001, AFTER_SUPPORT
 * overrides REGULAR when it's been explicitly set; otherwise REGULAR
 * wins. Returns null when neither phase has been rated.
 *
 * The "AFTER_SUPPORT overrides REGULAR" precedence matches the final
 * report calculation rule documented in cdc-compliance-deviations.md
 * — keeping the same rule in the UI guarantees what the teacher sees
 * matches what gets printed on a report card.
 */
export function getEffectiveRating(
  cell: CellState | undefined,
): 1 | 2 | 3 | 4 | null {
  if (!cell) return null;
  return cell.afterSupport ?? cell.regular;
}

/**
 * Displayed AFTER_SUPPORT value (for the ghosted-default render
 * pattern). Returns:
 *   • `{ value: <afterSupport>, isGhosted: false }` when the teacher
 *     has explicitly tapped an AFTER_SUPPORT button — the row shows
 *     this value as a normal filled button.
 *   • `{ value: <regular>, isGhosted: true }` when the teacher hasn't
 *     touched AFTER_SUPPORT but HAS rated REGULAR — the row shows
 *     REGULAR's value in the AFTER_SUPPORT column with dashed-border
 *     ghosted styling, communicating "this is what the report will
 *     use unless you override."
 *   • `{ value: null, isGhosted: false }` when neither phase is
 *     rated — the AFTER_SUPPORT column renders empty buttons.
 */
export function getDisplayedAfterSupport(cell: CellState | undefined): {
  value: 1 | 2 | 3 | 4 | null;
  isGhosted: boolean;
} {
  if (!cell) return { value: null, isGhosted: false };
  if (cell.afterSupport !== null)
    return { value: cell.afterSupport, isGhosted: false };
  if (cell.regular !== null) return { value: cell.regular, isGhosted: true };
  return { value: null, isGhosted: false };
}

// ---------------------------------------------------------------------------
// Mutators — applyRatingToCells (phase-parameterized).
// ---------------------------------------------------------------------------

export type RatingPhase = "REGULAR" | "AFTER_SUPPORT";

/**
 * Compute the new cells map after a rating tap. Pure — no React, no
 * side effects, suitable for `setCells(prev => applyRatingToCells(...))`.
 *
 * Behavior:
 *   • Returns a brand-new top-level object (preserves React state
 *     immutability).
 *   • Other students' cells are reused by reference (no needless
 *     deep clone).
 *   • Writes to EITHER the REGULAR pair (`regular` + `regularSyncStatus`)
 *     OR the AFTER_SUPPORT pair (`afterSupport` + `afterSupportSyncStatus`),
 *     depending on `phase`. The other phase's fields are preserved
 *     unchanged — a REGULAR tap never wipes AFTER_SUPPORT (and vice
 *     versa).
 *   • If `studentId` had no existing entry, an EMPTY_CELL is
 *     synthesized and its pulseKey starts at 0 → 1 on this tap.
 */
export function applyRatingToCells(
  cells: Record<string, CellState>,
  studentId: string,
  phase: RatingPhase,
  value: 1 | 2 | 3 | 4,
  syncStatus: CellSyncStatus,
): Record<string, CellState> {
  const existing = cells[studentId] ?? EMPTY_CELL;
  const updated: CellState =
    phase === "REGULAR"
      ? {
          ...existing,
          regular: value,
          regularSyncStatus: syncStatus,
          pulseKey: existing.pulseKey + 1,
        }
      : {
          ...existing,
          afterSupport: value,
          afterSupportSyncStatus: syncStatus,
          pulseKey: existing.pulseKey + 1,
        };
  return { ...cells, [studentId]: updated };
}

// ============================================================================
// applySeedToCells — pure helper for the rating-screen seed effect.
//
// Loop-fix contract carried through:
//   • If nothing new can be seeded (every unseeded student's records
//     are still loading, OR all students are already seeded), returns
//     `next === prev` (same reference). setState bails on identical
//     state, breaking the loop.
//   • Returns the list of student IDs that WERE newly seeded so the
//     caller can update its `seededFor` ref AFTER setState — keeps
//     the ref mutation out of the setState callback (which React
//     StrictMode double-invokes, so the callback must be pure).
//   • Only seeds students whose records are present in the byStudentId
//     map — students with no record yet are intentionally skipped so
//     their real data can seed them when it arrives.
//
// Deviation 001 update: the seeded cell carries BOTH `regular` and
// `afterSupport` (from records with the matching phase). Either may
// be null if no record exists for that phase, matching the rule that
// AFTER_SUPPORT is an explicit per-student decision (no row when not
// explicitly recorded).
// ============================================================================

export type SeedPhase = RatingPhase;

/** Minimal shape required by applySeedToCells — narrower than
 *  ContinuousRecordDto so tests can construct inputs cheaply. */
export interface SeedableRecord {
  phase: SeedPhase;
  outcomeId: string;
  rating: 1 | 2 | 3 | 4;
}

export interface SeedableStudent {
  id: string;
}

export interface SeedResult {
  /** Same reference as `prev` when nothing changed; new object otherwise. */
  next: Record<string, CellState>;
  /** Student IDs whose cells were newly populated. Empty array when
   *  no change — caller can skip the ref update entirely. */
  newlySeeded: ReadonlyArray<string>;
}

export function applySeedToCells(
  prev: Record<string, CellState>,
  students: ReadonlyArray<SeedableStudent>,
  byStudentId: ReadonlyMap<string, ReadonlyArray<SeedableRecord>>,
  outcomeId: string,
  alreadySeeded: ReadonlySet<string>,
): SeedResult {
  let next: Record<string, CellState> = prev;
  const newlySeeded: string[] = [];

  for (const s of students) {
    if (alreadySeeded.has(s.id)) continue;

    const studentRecs = byStudentId.get(s.id);
    if (!studentRecs) continue;

    const regularRec = studentRecs.find(
      (r) => r.phase === "REGULAR" && r.outcomeId === outcomeId,
    );
    const afterRec = studentRecs.find(
      (r) => r.phase === "AFTER_SUPPORT" && r.outcomeId === outcomeId,
    );

    if (next === prev) next = { ...prev };
    next[s.id] = {
      regular: regularRec?.rating ?? null,
      afterSupport: afterRec?.rating ?? null,
      regularSyncStatus: "synced",
      afterSupportSyncStatus: "synced",
      pulseKey: 0,
    };
    newlySeeded.push(s.id);
  }

  return { next, newlySeeded };
}
