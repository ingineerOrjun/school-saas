import { api } from "./api";

/**
 * Promotion = "close the year, roll students forward, open the next
 * year". Atomic on the backend — every change for every student plus
 * the new-session creation is one transaction. UI-side, this just
 * means the call either fully succeeds (school is in the new year)
 * or fully fails (no rows touched).
 *
 * Preconditions enforced server-side:
 *   • Active session must exist.
 *   • Active session must be LOCKED (admin clicks Lock first).
 */

export type StudentSessionStatus = "PROMOTED" | "RETAINED" | "LEFT";

export interface PromotionEntryInput {
  studentId: string;
  status: StudentSessionStatus;
  /** Required when status === "PROMOTED". */
  nextClassId?: string;
  /** Optional new section under nextClassId. */
  nextSectionId?: string;
}

export interface NextSessionInput {
  name: string;
  startDate: string;
  endDate: string;
}

export interface RunPromotionInput {
  entries: PromotionEntryInput[];
  nextSession: NextSessionInput;
}

export interface PromotionResult {
  fromSessionId: string;
  fromSessionName: string;
  toSessionId: string;
  toSessionName: string;
  counts: {
    promoted: number;
    retained: number;
    left: number;
    total: number;
  };
}

/** One row of a student's session-by-session class history. */
export interface StudentAcademicRecordDto {
  id: string;
  studentId: string;
  sessionId: string;
  session: { id: string; name: string };
  classId: string;
  class: { id: string; name: string };
  sectionId: string | null;
  section: { id: string; name: string } | null;
  schoolId: string;
  status: StudentSessionStatus;
  /**
   * Phase ACADEMIC TRANSITION SAFETY Part 6 — historical "promoted
   * to" snapshot. Distinct from the live Student.classId, which may
   * move again in subsequent runs.
   */
  nextClassId?: string | null;
  nextSectionId?: string | null;
  promotedById?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Phase ACADEMIC TRANSITION SAFETY Part 1 — dry-run preview types.
//
// Mirrors `PromotionValidationResult` on the backend. Keep the issue
// codes EXACTLY in sync; the UI maps codes to localized messages.
// ---------------------------------------------------------------------------

export type PromotionIssueCode =
  | "NO_ACTIVE_SESSION"
  | "SESSION_NOT_LOCKED"
  | "SESSION_ENDED"
  | "DUPLICATE_SESSION_NAME"
  | "INVALID_DATE_RANGE"
  | "OVERLAPPING_SESSION_DATES"
  | "DUPLICATE_STUDENT_IN_PAYLOAD"
  | "PROMOTED_MISSING_NEXT_CLASS"
  | "NEXT_CLASS_NOT_FOUND"
  | "NEXT_CLASS_ARCHIVED"
  | "NEXT_SECTION_MISMATCH"
  | "STUDENT_NOT_FOUND"
  | "STUDENT_ARCHIVED"
  | "STUDENT_NO_CURRENT_CLASS"
  | "STUDENT_ALREADY_PROMOTED"
  | "UNPUBLISHED_RESULTS_IN_SOURCE"
  | "LOCKED_EXAMS_IN_SOURCE";

export type PromotionIssueSeverity = "error" | "warning";

export interface PromotionIssue {
  code: PromotionIssueCode;
  severity: PromotionIssueSeverity;
  message: string;
  studentId?: string;
  classId?: string;
  examId?: string;
}

export interface PromotionPreviewEntry {
  studentId: string;
  studentName: string;
  currentClassId: string | null;
  currentClassName: string | null;
  proposedStatus: StudentSessionStatus;
  nextClassId: string | null;
  nextClassName: string | null;
  nextSectionId: string | null;
  archived: boolean;
  blocked: boolean;
  issues: PromotionIssue[];
}

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
    total: number;
    willPromote: number;
    willRetain: number;
    willLeave: number;
    blocked: number;
    withWarnings: number;
    archivedExcluded: number;
  };
  sessionIssues: PromotionIssue[];
  entries: PromotionPreviewEntry[];
  blockers: PromotionIssue[];
  warnings: PromotionIssue[];
  generatedAt: string;
}

export const promotionApi = {
  /**
   * Phase ACADEMIC TRANSITION SAFETY Part 1 — dry-run preview. Same
   * payload shape as `/promotion/run`; returns a `PromotionValidationResult`
   * that lists every blocker + warning the planned run would hit.
   * Always 200 OK with the report — operator-level issues live in
   * `result.blockers`, not HTTP errors. Hit this BEFORE `/run`.
   */
  preview: (input: RunPromotionInput) =>
    api<PromotionValidationResult>("/promotion/preview", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /**
   * Run the full promotion. Backend rejects if the active session
   * isn't locked or if the payload is internally inconsistent
   * (PROMOTED entries missing nextClassId, sections that don't
   * belong to the chosen class, etc.). UI should call `preview()`
   * first and only invoke `run()` when `canRun: true`.
   */
  run: (input: RunPromotionInput) =>
    api<PromotionResult>("/promotion/run", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /** History — one row per session for a single student. */
  studentHistory: (studentId: string) =>
    api<StudentAcademicRecordDto[]>(
      `/promotion/students/${encodeURIComponent(studentId)}/history`,
    ),
};

/**
 * Phase ACADEMIC TRANSITION SAFETY Part 7 — operator-friendly message
 * map for PromotionIssueCode. The backend already includes a default
 * English message in each issue; this map gives the UI a chance to
 * substitute clearer copy without losing the link to the issue code.
 *
 * Codes not present here fall back to `issue.message` from the API.
 */
export const PROMOTION_ISSUE_COPY: Partial<
  Record<PromotionIssueCode, { title: string; remediation: string }>
> = {
  NO_ACTIVE_SESSION: {
    title: "No active academic session",
    remediation: "Create or activate a session from Settings → Sessions.",
  },
  SESSION_NOT_LOCKED: {
    title: "Active session is not locked",
    remediation: "Lock the session first — promotion requires a frozen year.",
  },
  SESSION_ENDED: {
    title: "Session ended",
    remediation:
      "The current session is past its end date. Proceed only if this is the late-rollover you intended.",
  },
  DUPLICATE_SESSION_NAME: {
    title: "Next-session name already taken",
    remediation: "Rename the next session before retrying.",
  },
  INVALID_DATE_RANGE: {
    title: "Next-session date range is invalid",
    remediation: "Start date must come before the end date.",
  },
  OVERLAPPING_SESSION_DATES: {
    title: "Next session overlaps the current session",
    remediation:
      "Move the new session's start date to after the current session ends.",
  },
  DUPLICATE_STUDENT_IN_PAYLOAD: {
    title: "Duplicate student in payload",
    remediation: "Remove the extra row before retrying.",
  },
  PROMOTED_MISSING_NEXT_CLASS: {
    title: "Promoted student missing destination",
    remediation: "Pick a destination class for every PROMOTED student.",
  },
  NEXT_CLASS_NOT_FOUND: {
    title: "Destination class not found",
    remediation: "Refresh the class list — the chosen class may have been deleted.",
  },
  NEXT_CLASS_ARCHIVED: {
    title: "Destination class is archived",
    remediation: "Restore the class first, or choose a different one.",
  },
  NEXT_SECTION_MISMATCH: {
    title: "Section doesn't belong to chosen class",
    remediation: "Pick a section that actually lives under the destination class.",
  },
  STUDENT_NOT_FOUND: {
    title: "Student not found",
    remediation: "Refresh the roster — the student may have been deleted.",
  },
  STUDENT_ARCHIVED: {
    title: "Student is archived",
    remediation:
      "Restore the student first or remove them from the promotion list.",
  },
  STUDENT_NO_CURRENT_CLASS: {
    title: "Student has no current class",
    remediation: "Assign a class on the Students page before promoting.",
  },
  STUDENT_ALREADY_PROMOTED: {
    title: "Student already promoted",
    remediation:
      "This student is already recorded in the current session's promotion history.",
  },
  UNPUBLISHED_RESULTS_IN_SOURCE: {
    title: "Draft results in source session",
    remediation:
      "Publish the affected exams from /exams before promoting, or accept the warning.",
  },
  LOCKED_EXAMS_IN_SOURCE: {
    title: "Locked exams in source session",
    remediation:
      "Locked marks will remain frozen — no action required unless you intended to edit them post-promotion.",
  },
};
