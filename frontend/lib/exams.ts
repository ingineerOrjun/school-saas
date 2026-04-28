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
