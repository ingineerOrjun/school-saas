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

export const studentsApi = {
  list: (filter?: ListStudentsFilter) =>
    api<StudentDto[]>(`/students${buildListQuery(filter)}`),
  get: (id: string) => api<StudentDto>(`/students/${id}`),
  create: (input: CreateStudentInput) =>
    api<StudentDto>("/students", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateStudentInput) =>
    api<StudentDto>(`/students/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    api<void>(`/students/${id}`, { method: "DELETE" }),
};
