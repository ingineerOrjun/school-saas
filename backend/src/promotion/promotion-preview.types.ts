// ============================================================================
// Promotion preview type system — Phase ACADEMIC TRANSITION SAFETY Part 1.
//
// The preview engine is dry-run only: it reuses the same `RunPromotionDto`
// shape as the live executor (so the UI's payload doesn't fork), but it
// NEVER writes. Output is a validation report that drives the review UI
// (Part 2) and feeds the governance audit row (Part 3).
//
// Issue codes are an enum, not free-text strings, because:
//   • The frontend swaps long human messages per locale; the code is
//     the stable contract.
//   • Test suites can assert exact codes without coupling to copy.
//   • Severity (blocker vs warning) is fixed per code below — a code
//     never flips category at runtime.
// ============================================================================

/**
 * Every distinct preventable / surfaceable condition the preview can
 * detect. Add new codes here as the preview grows; never reuse the
 * same code with a different severity.
 */
export const PROMOTION_ISSUE_CODES = [
  // ---- Session-level (block everything) ----
  /** No active academic session exists for this school. */
  'NO_ACTIVE_SESSION',
  /** Active session is not locked — promotion requires lock-first. */
  'SESSION_NOT_LOCKED',
  /** Active session has already ended (today > endDate) — warn. */
  'SESSION_ENDED',
  /** The next-session payload's name collides with an existing session. */
  'DUPLICATE_SESSION_NAME',
  /** Next-session date range is invalid (start >= end). */
  'INVALID_DATE_RANGE',
  /** Next-session start date is before the current session's end. */
  'OVERLAPPING_SESSION_DATES',

  // ---- Payload-level (block specific rows) ----
  /** The same studentId appears in `entries` more than once. */
  'DUPLICATE_STUDENT_IN_PAYLOAD',
  /** A PROMOTED entry didn't supply nextClassId. */
  'PROMOTED_MISSING_NEXT_CLASS',
  /** The supplied nextClassId doesn't exist in this school. */
  'NEXT_CLASS_NOT_FOUND',
  /** The supplied nextClassId points at an archived class. */
  'NEXT_CLASS_ARCHIVED',
  /** A supplied nextSectionId doesn't belong to nextClassId. */
  'NEXT_SECTION_MISMATCH',

  // ---- Student-level ----
  /** Referenced studentId doesn't exist or isn't in this school. */
  'STUDENT_NOT_FOUND',
  /** Student is currently archived — promotion of archived students
   *  must be explicitly opted into; default preview blocks. */
  'STUDENT_ARCHIVED',
  /** Student has no current class — we can't snapshot "promoted from"
   *  honestly, so the row is blocked until the student is placed. */
  'STUDENT_NO_CURRENT_CLASS',
  /** Student already has a StudentAcademicRecord for the active
   *  session — they were included in a previous run already. */
  'STUDENT_ALREADY_PROMOTED',

  // ---- Result-dependency warnings ----
  /** Source session has results that are still in DRAFT (unpublished).
   *  Promoting before publishing would freeze unreviewed marks. */
  'UNPUBLISHED_RESULTS_IN_SOURCE',
  /** Source session has at least one exam that is locked but not
   *  archived — informational; not a blocker. */
  'LOCKED_EXAMS_IN_SOURCE',
] as const;

/** Discriminated-union code type. */
export type PromotionIssueCode = (typeof PROMOTION_ISSUE_CODES)[number];

/** Severity of a single issue. */
export type PromotionIssueSeverity = 'error' | 'warning';

/**
 * Fixed map from code → severity. Used by the preview to bucket
 * findings into `blockers` vs `warnings`. Errors block execution;
 * warnings are surfaced but do not. Keep this in lockstep with the
 * code list above — codes without an entry default to 'error'.
 */
export const ISSUE_SEVERITY: Record<PromotionIssueCode, PromotionIssueSeverity> = {
  NO_ACTIVE_SESSION: 'error',
  SESSION_NOT_LOCKED: 'error',
  SESSION_ENDED: 'warning',
  DUPLICATE_SESSION_NAME: 'error',
  INVALID_DATE_RANGE: 'error',
  OVERLAPPING_SESSION_DATES: 'warning',
  DUPLICATE_STUDENT_IN_PAYLOAD: 'error',
  PROMOTED_MISSING_NEXT_CLASS: 'error',
  NEXT_CLASS_NOT_FOUND: 'error',
  NEXT_CLASS_ARCHIVED: 'error',
  NEXT_SECTION_MISMATCH: 'error',
  STUDENT_NOT_FOUND: 'error',
  STUDENT_ARCHIVED: 'error',
  STUDENT_NO_CURRENT_CLASS: 'error',
  STUDENT_ALREADY_PROMOTED: 'error',
  UNPUBLISHED_RESULTS_IN_SOURCE: 'warning',
  LOCKED_EXAMS_IN_SOURCE: 'warning',
};

/**
 * A single issue surfaced by the preview. Carries the stable code,
 * a default human-readable message (UI may override per locale), and
 * optional scope pointers (which student / class / exam triggered it)
 * so the review UI can highlight the right row.
 */
export interface PromotionIssue {
  code: PromotionIssueCode;
  severity: PromotionIssueSeverity;
  /** English fallback message — UI can localize per code. */
  message: string;
  studentId?: string;
  classId?: string;
  examId?: string;
}

/**
 * Per-row preview outcome. One entry per student in the incoming
 * payload (or one synthesised entry for "in-source but missing from
 * payload" if we ever surface that — currently we don't).
 *
 * `blocked` is the convenience boolean — true when any of `issues`
 * is severity 'error'. The UI reads this directly rather than
 * recomputing.
 */
export interface PromotionPreviewEntry {
  studentId: string;
  studentName: string;
  /** Current class snapshot (label + id) for the review table. */
  currentClassId: string | null;
  currentClassName: string | null;
  proposedStatus: 'PROMOTED' | 'RETAINED' | 'LEFT';
  /** Destination class for PROMOTED rows. */
  nextClassId: string | null;
  nextClassName: string | null;
  nextSectionId: string | null;
  /** Archived state echo so the review UI can pair with the badge. */
  archived: boolean;
  blocked: boolean;
  issues: PromotionIssue[];
}

/**
 * Aggregate of the preview pass.
 *
 *   • `canRun` is the single boolean the UI consults to decide whether
 *     the "Execute promotion" button is enabled. It mirrors
 *     `blockers.length === 0`.
 *   • `counts.willPromote` etc. are AFTER applying the blocker filter:
 *     a row blocked by STUDENT_ARCHIVED contributes to `blocked`, not
 *     to `willPromote`.
 */
export interface PromotionValidationResult {
  canRun: boolean;
  fromSession: {
    id: string;
    name: string;
    isActive: boolean;
    isLocked: boolean;
    endDate: string;
  } | null;
  nextSession: {
    name: string;
    startDate: string;
    endDate: string;
  };
  counts: {
    /** Total entries in the payload. */
    total: number;
    /** Sum of PROMOTED entries that wouldn't be blocked. */
    willPromote: number;
    /** Sum of RETAINED entries that wouldn't be blocked. */
    willRetain: number;
    /** Sum of LEFT entries that wouldn't be blocked. */
    willLeave: number;
    /** Sum of entries with at least one blocker issue. */
    blocked: number;
    /** Sum of entries with at least one warning (and zero blockers). */
    withWarnings: number;
    /** Subset of blocked due to STUDENT_ARCHIVED specifically — drives
     *  the "Archived exclusions" callout in the review UI. */
    archivedExcluded: number;
  };
  /** Issues NOT scoped to a single row (e.g. session-level). */
  sessionIssues: PromotionIssue[];
  /** Per-row outcomes — order matches the incoming payload. */
  entries: PromotionPreviewEntry[];
  /** Convenience: every error across both sessionIssues + entries. */
  blockers: PromotionIssue[];
  /** Convenience: every warning across both sessionIssues + entries. */
  warnings: PromotionIssue[];
  generatedAt: string;
}
