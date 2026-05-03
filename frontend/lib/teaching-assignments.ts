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
   * Teacher-only on the backend. Returns the caller's own assignments.
   * Used by the teacher dashboard, attendance dropdown, and exam picker
   * to filter what the teacher can act on.
   */
  listMine: () =>
    api<TeachingAssignmentDto[]>("/teachers/me/assignments"),
};
