import { api } from "./api";
import type { ClassDto } from "./classes";

export type Gender = "MALE" | "FEMALE" | "OTHER";

export interface StudentSectionDto {
  id: string;
  name: string;
  classId: string;
  createdAt: string;
  updatedAt: string;
  class: ClassDto;
}

export interface StudentDto {
  id: string;
  firstName: string;
  lastName: string;
  /** Nepal-style Symbol / Roll number. Unique within a school when present. */
  symbolNumber: string | null;
  schoolId: string;
  userId: string | null;
  /** Required demographic + contact fields. */
  gender: Gender;
  dateOfBirth: string;
  parentName: string;
  contactNumber: string;
  /** Optional. */
  address: string | null;
  admissionDate: string | null;
  /**
   * Direct class link. Populated for every student who has been assigned to
   * either a class or a section (the backend derives classId from the
   * section when only a section is provided). Null for unassigned students.
   */
  classId: string | null;
  class: ClassDto | null;
  sectionId: string | null;
  section: StudentSectionDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStudentInput {
  firstName: string;
  lastName: string;
  symbolNumber?: string | null;
  /** Required by the backend. */
  gender: Gender;
  dateOfBirth: string;
  parentName: string;
  contactNumber: string;
  /** Optional. */
  address?: string | null;
  admissionDate?: string | null;
  userId?: string;
  classId?: string | null;
  sectionId?: string | null;
}

export interface UpdateStudentInput {
  firstName?: string;
  lastName?: string;
  symbolNumber?: string | null;
  gender?: Gender;
  dateOfBirth?: string;
  parentName?: string;
  contactNumber?: string;
  address?: string | null;
  admissionDate?: string | null;
  userId?: string;
  classId?: string | null;
  sectionId?: string | null;
}

export interface ListStudentsFilter {
  /** When set, only students in this class are returned. */
  classId?: string;
  /** When true, only students without any class assignment are returned. */
  unassigned?: boolean;
}

function buildListQuery(filter?: ListStudentsFilter): string {
  if (!filter) return "";
  const params = new URLSearchParams();
  if (filter.unassigned) params.set("unassigned", "1");
  else if (filter.classId) params.set("classId", filter.classId);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** One row in a bulk-import payload — mirrors backend BulkStudentInput. */
export interface BulkStudentInput {
  firstName: string;
  lastName: string;
  symbolNumber?: string | null;
  gender: Gender;
  dateOfBirth: string;
  parentName: string;
  contactNumber: string;
  address?: string | null;
  admissionDate?: string | null;
  className?: string | null;
}

export interface BulkFailure {
  rowIndex: number;
  reason: string;
}

export interface BulkCreateResult {
  successCount: number;
  failed: BulkFailure[];
}

/**
 * Aggregated student analytics — mirror of the backend `StudentAnalytics`.
 * Powers the Analytics Center's Student tab.
 */
export interface StudentAnalytics {
  total: number;
  genderSplit: Array<{
    gender: "MALE" | "FEMALE" | "OTHER";
    count: number;
  }>;
  classStrength: Array<{
    classId: string | null;
    className: string;
    count: number;
  }>;
  admissionsTrend: Array<{
    month: string;
    count: number;
  }>;
  generatedAt: string;
}

export const studentsApi = {
  list: (filter?: ListStudentsFilter) =>
    api<StudentDto[]>(`/students${buildListQuery(filter)}`),
  /**
   * Multi-field typeahead used by the cashier workspace. Matches `q`
   * against name, symbol no, phone, and parent name. Empty query
   * returns the most-recently-created students (the "no input yet"
   * dropdown state). Capped at `limit` (default 10).
   */
  search: (q: string, limit = 10) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("limit", String(limit));
    return api<StudentDto[]>(`/students/search?${params.toString()}`);
  },
  /**
   * Aggregated student analytics for the Analytics Center. Admin-only
   * server-side; the page-level role gate ensures non-admins never
   * even reach the call site.
   */
  getAnalytics: () => api<StudentAnalytics>("/students/analytics"),
  get: (id: string) => api<StudentDto>(`/students/${id}`),
  create: (input: CreateStudentInput) =>
    api<StudentDto>("/students", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  bulkCreate: (students: BulkStudentInput[]) =>
    api<BulkCreateResult>("/students/bulk", {
      method: "POST",
      body: JSON.stringify({ students }),
    }),
  update: (id: string, input: UpdateStudentInput) =>
    api<StudentDto>(`/students/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    api<void>(`/students/${id}`, { method: "DELETE" }),
};
