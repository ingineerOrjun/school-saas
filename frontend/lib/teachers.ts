import { api } from "./api";

export interface TeacherClassRef {
  id: string;
  name: string;
}

export interface TeacherSectionRef {
  id: string;
  name: string;
  class: TeacherClassRef;
}

export interface TeacherDto {
  id: string;
  name: string;
  schoolId: string;
  userId: string | null;
  /**
   * Class assignment. Null until an admin assigns the teacher.
   * `class` is populated whenever `classId` is set.
   */
  classId: string | null;
  class: TeacherClassRef | null;
  /**
   * Optional narrower section. When set, the teacher's writes are
   * limited to that section instead of the whole class.
   */
  sectionId: string | null;
  section: TeacherSectionRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTeacherInput {
  name: string;
  userId?: string;
  classId?: string | null;
  sectionId?: string | null;
}

export interface UpdateTeacherInput {
  name?: string;
  userId?: string;
  classId?: string | null;
  sectionId?: string | null;
}

/**
 * Payload for the one-step "create teacher + login" endpoint. Used by
 * the Add Teacher dialog when an admin wants to provision a new teacher
 * who can log in immediately.
 */
export interface CreateTeacherWithUserInput {
  name: string;
  email: string;
  password: string;
  classId?: string | null;
  sectionId?: string | null;
}

/** Minimal user shape returned alongside the teacher (no password). */
export interface TeacherUserRef {
  id: string;
  email: string;
  role: "ADMIN" | "TEACHER" | "STUDENT" | "PARENT";
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
   * on the backend. The returned teacher has `userId` already linked, so
   * the new teacher can sign in with the email/password right away.
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
};
