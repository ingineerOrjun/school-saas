import { api } from "./api";
import type { LetterGrade } from "./grading";

export interface ExamSubjectDto {
  id: string;
  name: string;
  theoryFullMarks: number;
  practicalFullMarks: number;
  /**
   * Credit-hour weight used in the credit-hour-weighted GPA (CDC
   * progress-report formula). Optional in the typing for back-compat —
   * older clients ignore it; new ones default missing values to 5.
   */
  creditHours?: number;
  examId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamDto {
  id: string;
  name: string;
  schoolId: string;
  subjects: ExamSubjectDto[];
  /**
   * Marks-publication lock state. When `locked` is true, every backend
   * results-write path rejects with HTTP 423. The `lockedAt` /
   * `lockedById` fields exist for the audit trail but the platform
   * audit stream is the authoritative history.
   */
  locked?: boolean;
  lockedAt?: string | null;
  lockedById?: string | null;
  /**
   * Phase ACADEMIC TRANSITION SAFETY Part 4 — publication state.
   * Orthogonal to `locked`: a published exam can still be unlocked.
   * State derives as: locked → Locked, publishedAt → Published,
   * otherwise → Draft. Optional in the typing for back-compat with
   * API responses that pre-date the field.
   */
  publishedAt?: string | null;
  publishedById?: string | null;
  /**
   * Phase DATA LIFECYCLE Part 1: soft-delete state. Non-null
   * `archivedAt` means the exam is hidden from default listings and
   * marks-write rejects until restored.
   */
  archivedAt?: string | null;
  archivedById?: string | null;
  archiveReason?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Phase ACADEMIC TRANSITION SAFETY Part 4 — three-state publication
 * derivation. Used by the badges + the marksheet header chrome.
 *
 *   • Draft     → publishedAt = null AND locked = false (default)
 *   • Published → publishedAt != null AND locked = false
 *   • Locked    → locked = true (whether or not publishedAt is set)
 *
 * Locked dominates — once marks are frozen, the operator-relevant
 * state is "frozen", regardless of whether visibility was ever
 * toggled on. The audit log carries the full lock+publish trail.
 */
export type ExamPublicationState = "draft" | "published" | "locked";

export function deriveExamState(
  exam: Pick<ExamDto, "locked" | "publishedAt">,
): ExamPublicationState {
  if (exam.locked) return "locked";
  if (exam.publishedAt) return "published";
  return "draft";
}

export interface ResultRow {
  id: string;
  subjectId: string;
  subjectName: string;
  /** Sum of theoryFullMarks + practicalFullMarks (kept for backward-compat). */
  fullMarks: number;
  /** Sum of theoryMarks + practicalMarks (kept for backward-compat). */
  marks: number;
  theoryMarks: number;
  practicalMarks: number;
  theoryFullMarks: number;
  practicalFullMarks: number;
  /** True when either component fell below the 35% pass bar. */
  failedComponent: boolean;
  percentage: number;
  letterGrade: LetterGrade;
  letterGradeLabel: string;
  gradePoint: number;
  /**
   * Credit-hour weight for this subject. Optional in the typing for
   * back-compat with API responses that pre-date the field; consumers
   * default missing values to 5.
   */
  creditHours?: number;
}

export interface StudentReport {
  examId: string;
  examName: string;
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  results: ResultRow[];
  /**
   * Credit-hour-weighted GPA (CDC progress-report formula). Always a
   * number for back-compat with `.toFixed(2)` callers; the visual NG
   * state is surfaced via `gpaLetterGrade === "NG"` and
   * `hasFailingSubject`. The value is the sentinel `-1` (out-of-range
   * for valid GPAs 0.0–4.0) when any subject is NG, distinguishing
   * NG from a student who genuinely scored 0.0. Renderers should
   * guard with `gpa < 0` (or check `gpaLetterGrade === "NG"`) before
   * formatting.
   */
  gpa: number;
  /**
   * Letter grade derived from `gpa` via the CDC overall-GPA mapping
   * (3.6 → A+, 3.2 → A, ...). "NG" when any subject is NG. Optional in
   * the typing so older API responses (without this field) don't crash
   * the client; consumers should fall back to `overallLetterGradeLabel`.
   */
  gpaLetterGrade?: string;
  /** Sum of credit hours used as the weighted-GPA denominator. */
  totalCreditHours?: number;
  overallLetterGrade: LetterGrade;
  overallLetterGradeLabel: string;
  /** True when at least one subject's letter grade is NG. */
  hasFailingSubject: boolean;
}

export interface CreateExamInput {
  name: string;
}

export interface CreateSubjectInput {
  name: string;
  theoryFullMarks: number;
  practicalFullMarks?: number;
  /**
   * Credit-hour weight (CDC weekly-period count). Optional — backend
   * defaults missing values to 5, matching the schema column default.
   * Range 0.5–20 enforced server-side by the DTO.
   */
  creditHours?: number;
}

export interface ResultEntry {
  subjectId: string;
  theoryMarks: number;
  practicalMarks?: number;
}

export interface SaveResultsInput {
  examId: string;
  studentId: string;
  entries: ResultEntry[];
}

/**
 * Bulk-marks payload — one subject across many students. Mirrors
 * `BulkSaveResultsDto` on the backend. The subject is hoisted out of
 * each entry because the whole batch is for the same subject.
 *
 *   • subjectId — `ExamSubject.id` (per-exam subject row)
 *   • sectionId — null/omitted → target the "no-section" subset of
 *     the class; set → target only that section
 */
export interface BulkResultEntry {
  studentId: string;
  theoryMarks: number;
  practicalMarks?: number;
}

export interface BulkSaveResultsInput {
  examId: string;
  classId: string;
  sectionId?: string | null;
  subjectId: string;
  entries: BulkResultEntry[];
}

export interface BulkSaveResultsResult {
  successCount: number;
}

/**
 * Aggregated analytics for a single exam — mirrors the backend
 * `ExamAnalytics` shape. Powers the Analytics Center's Exam tab.
 */
export interface ExamAnalytics {
  exam: {
    id: string;
    name: string;
    sessionId: string | null;
    createdAt: string;
    subjectCount: number;
  };
  studentCount: number;
  studentOutcomes: {
    passed: number;
    failed: number;
    pending: number;
  };
  gradeDistribution: Array<{
    grade: LetterGrade;
    count: number;
  }>;
  subjects: Array<{
    subjectId: string;
    name: string;
    resultsCount: number;
    averagePercentage: number;
    passRate: number;
    topper: {
      studentId: string;
      firstName: string;
      lastName: string;
      symbolNumber: string | null;
      percentage: number;
    } | null;
  }>;
  topPerformers: Array<{
    studentId: string;
    firstName: string;
    lastName: string;
    symbolNumber: string | null;
    averagePercentage: number;
    subjectsTaken: number;
  }>;
  generatedAt: string;
}

export const examsApi = {
  /**
   * List exams. Backend defaults to the active session when
   * `sessionId` is omitted (legacy NULL fallback when no session is
   * active). Pass an explicit id to view a different session.
   *
   * `archived` (Phase DATA LIFECYCLE Part 1):
   *   • true   → only archived rows
   *   • "all"  → both active + archived
   *   • undef  → active only (default)
   */
  list: (sessionId?: string, archived?: boolean | "all") => {
    const params = new URLSearchParams();
    if (sessionId) params.set("sessionId", sessionId);
    if (archived === true) params.set("archived", "1");
    else if (archived === "all") params.set("archived", "all");
    const qs = params.toString();
    return api<ExamDto[]>(`/exams${qs ? `?${qs}` : ""}`);
  },
  create: (input: CreateExamInput) =>
    api<ExamDto>("/exams", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  remove: (id: string) => api<void>(`/exams/${id}`, { method: "DELETE" }),

  /**
   * Soft-archive an exam. Idempotent. ADMIN-only server-side. The
   * reason is shown back in the platform audit feed and the
   * ArchivedBadge tooltip.
   */
  archive: (examId: string, reason?: string) =>
    api<ExamDto>(`/exams/${encodeURIComponent(examId)}/archive`, {
      method: "POST",
      body: JSON.stringify({ reason: reason ?? undefined }),
    }),
  /** Restore an archived exam. Idempotent. ADMIN-only server-side. */
  restore: (examId: string) =>
    api<ExamDto>(`/exams/${encodeURIComponent(examId)}/restore`, {
      method: "POST",
    }),

  /** Per-exam analytics for the Analytics Center. */
  getAnalytics: (examId: string) =>
    api<ExamAnalytics>(`/exams/${encodeURIComponent(examId)}/analytics`),

  addSubject: (examId: string, input: CreateSubjectInput) =>
    api<ExamSubjectDto>(`/exams/${examId}/subjects`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  removeSubject: (id: string) =>
    api<void>(`/exam-subjects/${id}`, { method: "DELETE" }),

  /**
   * Marks-publication lock. ADMIN-only on the backend. Idempotent:
   * locking an already-locked exam is a no-op (no audit emit, no
   * timestamp change). After this lands every result-save path
   * rejects with HTTP 423.
   */
  lock: (examId: string) =>
    api<ExamDto>(`/exams/${encodeURIComponent(examId)}/lock`, {
      method: "PATCH",
    }),
  /** Mirror of `lock` — re-enables marks edits. ADMIN-only. */
  unlock: (examId: string) =>
    api<ExamDto>(`/exams/${encodeURIComponent(examId)}/unlock`, {
      method: "PATCH",
    }),

  /**
   * Phase ACADEMIC TRANSITION SAFETY Part 4 — publish marks (parent-
   * facing visibility). Idempotent server-side. ADMIN-only.
   */
  publish: (examId: string) =>
    api<ExamDto>(`/exams/${encodeURIComponent(examId)}/publish`, {
      method: "PATCH",
    }),
  /**
   * Unpublish — return marks to Draft state. ADMIN-only. Rejects 409
   * if the exam is locked (unlock first).
   */
  unpublish: (examId: string) =>
    api<ExamDto>(`/exams/${encodeURIComponent(examId)}/unpublish`, {
      method: "PATCH",
    }),
};

export const resultsApi = {
  save: (input: SaveResultsInput) =>
    api<StudentReport>("/results/save", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /**
   * Bulk-save: one subject for many students at once. The single-row
   * `save` above is unchanged and still in use — bulk is purely
   * additive.
   */
  bulkSave: (input: BulkSaveResultsInput) =>
    api<BulkSaveResultsResult>("/results/bulk-save", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  get: (examId: string, studentId: string) =>
    api<StudentReport>(
      `/results?examId=${encodeURIComponent(examId)}&studentId=${encodeURIComponent(studentId)}`,
    ),
};

export interface Marksheet extends StudentReport {
  school: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
  studentSymbolNumber: string | null;
  studentSection: {
    name: string;
    className: string;
  } | null;
  examCreatedAt: string;
  generatedAt: string;
  /**
   * Marks-publication lock state from the parent Exam. Drives the
   * LockedBadge in the marksheet header. Optional in the typing for
   * back-compat with API responses that pre-date the field — the
   * renderer falls back to `false` when missing.
   */
  examLocked?: boolean;
  examLockedAt?: string | null;
}

export const marksheetApi = {
  get: (examId: string, studentId: string) =>
    api<Marksheet>(
      `/reports/marksheet/${encodeURIComponent(examId)}/${encodeURIComponent(studentId)}`,
    ),
};

// ---------------------------------------------------------------------------
// Class-wide grade ledger
// ---------------------------------------------------------------------------

export interface LedgerSubject {
  id: string;
  name: string;
  /** Credit-hour weight for this subject. Optional for back-compat. */
  creditHours?: number;
}

export interface LedgerCell {
  subjectId: string;
  /** Letter grade label (A+, A, B+, ..., NG). Null if no result. */
  grade: string | null;
  gradePoint: number | null;
}

export interface LedgerStudentRow {
  id: string;
  name: string;
  symbolNumber: string | null;
  results: LedgerCell[];
  gpa: number;
  /** Final overall letter grade (NG-if-fail). Null when no results recorded. */
  finalResult: string | null;
}

export interface ClassLedger {
  exam: { id: string; name: string };
  class: { id: string; name: string };
  /** Owning school — used to render the printable header. */
  school: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
  };
  subjects: LedgerSubject[];
  students: LedgerStudentRow[];
  generatedAt: string;
}

export const ledgerApi = {
  get: (examId: string, classId: string) =>
    api<ClassLedger>(
      `/results/ledger?examId=${encodeURIComponent(examId)}&classId=${encodeURIComponent(classId)}`,
    ),
};

// ---------------------------------------------------------------------------
// Marks-entry grid (`/exams/marks-entry`)
// ---------------------------------------------------------------------------
// Simpler bulk path than `resultsApi.bulkSave` — single `obtainedMarks`
// column + `absent` flag per row, designed for the fast-typing grid
// where teachers tab through a class and enter one number per student.
//
// Coexists with the existing `/results/bulk-save` (theory + practical)
// and `/results/save` (per-student) endpoints; nothing here replaces
// them, the grid is additive.
// ---------------------------------------------------------------------------

/** One row returned by `GET /results/grid-roster`. */
export interface GridRosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  symbolNumber: string | null;
  /**
   * Existing result for this (exam × subject) pairing, if the student
   * already has marks recorded. `null` = no result yet (blank cell);
   * `obtainedMarks: null` AND `absent: true` = marked absent.
   */
  existing: {
    obtainedMarks: number | null;
    absent: boolean;
  } | null;
}

export interface GridRosterPayload {
  exam: { id: string; name: string };
  class: { id: string; name: string };
  section: { id: string; name: string } | null;
  subject: {
    id: string;
    name: string;
    /** Theory full marks — the displayable max for this grid. */
    fullMarks: number;
    /**
     * True when the subject also has a practical component. The grid
     * can't grade practicals (one number per row); UIs use this flag
     * to render a "use single-student entry" callout instead.
     */
    hasPractical: boolean;
  };
  students: GridRosterStudent[];
}

/** One row in a `POST /results/grid-save` payload. */
export interface GridResultEntry {
  studentId: string;
  obtainedMarks: number | null;
  absent?: boolean;
}

export interface GridSaveResultsInput {
  examId: string;
  classId: string;
  sectionId?: string | null;
  subjectId: string;
  marks: GridResultEntry[];
}

export interface GridSaveResultsResult {
  success: true;
  updatedCount: number;
}

export const marksGridApi = {
  /**
   * Hydrate the grid: roster + existing marks in a single call.
   * Pass `sectionId` as `null` (or omit) to target the no-section
   * subset of the class.
   */
  roster: (input: {
    examId: string;
    classId: string;
    subjectId: string;
    sectionId?: string | null;
  }) => {
    const params = new URLSearchParams({
      examId: input.examId,
      classId: input.classId,
      subjectId: input.subjectId,
    });
    if (input.sectionId) params.set("sectionId", input.sectionId);
    return api<GridRosterPayload>(`/results/grid-roster?${params.toString()}`);
  },

  /**
   * Save the grid in one transaction. Returns
   * `{ success: true, updatedCount }`. Rows where `obtainedMarks` is
   * null AND `absent` is falsy are SKIPPED on the backend (the grid
   * intentionally leaves "haven't decided yet" cells alone).
   */
  save: (input: GridSaveResultsInput) =>
    api<GridSaveResultsResult>("/results/grid-save", {
      method: "POST",
      body: JSON.stringify(input),
    }),
};
