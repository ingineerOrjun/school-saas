import { api } from "./api";

export interface AssignmentClassRef {
  id: string;
  name: string;
}

export interface AssignmentSectionRef {
  id: string;
  name: string;
  class: AssignmentClassRef;
}

export interface AssignmentSubjectRef {
  id: string;
  name: string;
}

/**
 * One row in `TeachingAssignment` — pairs a teacher with a class
 * (optional section, optional subject). The relations are eagerly
 * included so the UI can render names without follow-up requests.
 */
export interface TeachingAssignmentDto {
  id: string;
  teacherId: string;
  schoolId: string;
  classId: string;
  class: AssignmentClassRef;
  sectionId: string | null;
  section: AssignmentSectionRef | null;
  subjectId: string | null;
  subject: AssignmentSubjectRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeachingAssignmentInput {
  classId: string;
  sectionId?: string | null;
  subjectId?: string | null;
}

/**
 * One (class, optional section, optional subject) tuple used in a
 * bulk reconcile call. Both `add` and `remove` arrays carry the
 * same shape — rows are addressed by tuple, not by row id.
 */
export interface BulkAssignmentTuple {
  classId: string;
  sectionId?: string | null;
  subjectId?: string | null;
}

export interface BulkTeachingAssignmentsInput {
  add: BulkAssignmentTuple[];
  remove: BulkAssignmentTuple[];
}

export const teachingAssignmentsApi = {
  /** Admin-only on the backend. */
  listForTeacher: (teacherId: string) =>
    api<TeachingAssignmentDto[]>(`/teachers/${teacherId}/assignments`),

  /** Admin-only on the backend. */
  create: (teacherId: string, input: CreateTeachingAssignmentInput) =>
    api<TeachingAssignmentDto>(`/teachers/${teacherId}/assignments`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /** Admin-only on the backend. */
  remove: (id: string) =>
    api<void>(`/teaching-assignments/${id}`, { method: "DELETE" }),

  /**
   * Admin-only. Reconcile a teacher's assignments against a diff: the
   * server applies all `add` and `remove` tuples in a single
   * transaction and returns the resulting full list.
   *
   * Idempotent — `add` of an existing tuple and `remove` of a missing
   * one are both no-ops, so retries are safe.
   */
  bulk: (teacherId: string, input: BulkTeachingAssignmentsInput) =>
    api<TeachingAssignmentDto[]>(
      `/teachers/${teacherId}/assignments/bulk`,
      {
        method: "POST",
        body: JSON.stringify(input),
      },
    ),

  /**
   * Teacher-only on the backend. Returns the caller's own assignments.
   * Used by the teacher dashboard, attendance dropdown, and exam picker
   * to filter what the teacher can act on.
   *
   * `redirectOn403: false` is paired with the documented "no logout
   * on 403" policy in api.ts — explicit here so future readers can
   * see we want any 403 (e.g., admin/staff caller hitting the
   * teacher-only endpoint, or a teacher whose Teacher row was
   * deleted server-side) to surface as a thrown ApiError that the
   * UI converts into a "no classes assigned yet" empty state, not
   * an auto-logout.
   */
  listMine: () =>
    api<TeachingAssignmentDto[]>("/teachers/me/assignments", {
      redirectOn403: false,
    }),
};
