import { api } from "./api";
import type { LetterGrade } from "./grading";

export interface ExamSubjectDto {
  id: string;
  name: string;
  theoryFullMarks: number;
  practicalFullMarks: number;
  examId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExamDto {
  id: string;
  name: string;
  schoolId: string;
  subjects: ExamSubjectDto[];
  createdAt: string;
  updatedAt: string;
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
}

export interface StudentReport {
  examId: string;
  examName: string;
  studentId: string;
  studentFirstName: string;
  studentLastName: string;
  results: ResultRow[];
  gpa: number;
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

export const examsApi = {
  list: () => api<ExamDto[]>("/exams"),
  create: (input: CreateExamInput) =>
    api<ExamDto>("/exams", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  remove: (id: string) => api<void>(`/exams/${id}`, { method: "DELETE" }),

  addSubject: (examId: string, input: CreateSubjectInput) =>
    api<ExamSubjectDto>(`/exams/${examId}/subjects`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  removeSubject: (id: string) =>
    api<void>(`/exam-subjects/${id}`, { method: "DELETE" }),
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
