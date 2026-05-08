import { api } from "./api";

/**
 * Distinct counts for a teacher's TeachingAssignment rows. Returned
 * inline on every teacher payload so the admin table can render
 * "3 Classes · 5 Subjects" without a follow-up call.
 *
 * `sections` and `subjects` count only NON-NULL ids on the underlying
 * assignment rows — class-bound (no section) and subject-less rows
 * deliberately don't inflate those tallies.
 */
export interface TeacherAssignmentCounts {
  total: number;
  classes: number;
  sections: number;
  subjects: number;
}

/**
 * Public teacher row. After the legacy column drop in 20260511,
 * a Teacher only carries identity + counts:
 *   • The legacy `classId` / `sectionId` fields are gone.
 *   • A teacher ALWAYS has a linked User (createWithUser is the only
 *     creation path), so `userId` is required, not nullable.
 *   • Class/subject scope is in `assignmentCounts` (summary) and the
 *     `/teaching-assignments` endpoints (full rows).
 */
export interface TeacherDto {
  id: string;
  name: string;
  schoolId: string;
  userId: string;
  assignmentCounts: TeacherAssignmentCounts;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeacherInput {
  name: string;
  userId?: string;
}

export interface UpdateTeacherInput {
  name?: string;
  userId?: string;
}

/**
 * Payload for the one-step "create teacher + login" endpoint. Used by
 * the Add Teacher dialog. Class/subject assignment is a separate step
 * via the AssignmentsDialog grid — the backend hard-blocks teacher
 * login until at least one assignment exists.
 */
export interface CreateTeacherWithUserInput {
  name: string;
  email: string;
  password: string;
}

/** Minimal user shape returned alongside the teacher (no password). */
export interface TeacherUserRef {
  id: string;
  email: string;
  role: "ADMIN" | "STAFF" | "TEACHER" | "STUDENT" | "PARENT";
  schoolId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeacherWithUserResult {
  teacher: TeacherDto;
  user: TeacherUserRef;
}

export const teachersApi = {
  list: () => api<TeacherDto[]>("/teachers"),
  get: (id: string) => api<TeacherDto>(`/teachers/${id}`),
  create: (input: CreateTeacherInput) =>
    api<TeacherDto>("/teachers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /**
   * Creates a User (role=TEACHER) AND a Teacher row in one transaction
   * on the backend. The new teacher can sign in once an admin has
   * granted them at least one TeachingAssignment via the AssignmentsDialog
   * (login is hard-blocked otherwise).
   */
  createWithUser: (input: CreateTeacherWithUserInput) =>
    api<CreateTeacherWithUserResult>("/teachers/create-with-user", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateTeacherInput) =>
    api<TeacherDto>(`/teachers/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    api<void>(`/teachers/${id}`, { method: "DELETE" }),
  /**
   * Compact assignment counts for a single teacher. Same shape that's
   * embedded inline on every list/findOne response — exposed as its
   * own endpoint for callers that want only the summary.
   */
  assignmentSummary: (id: string) =>
    api<TeacherAssignmentCounts>(`/teachers/${id}/assignment-summary`),
};
