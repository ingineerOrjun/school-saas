import { api } from "./api";

/**
 * School-owned subject catalog. Used by `TeachingAssignment` to express
 * "this teacher teaches Math to Class 8". Read by anyone authenticated;
 * writes are admin-only on the backend.
 */
export interface SubjectDto {
  id: string;
  name: string;
  schoolId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSubjectInput {
  name: string;
}

export interface UpdateSubjectInput {
  name?: string;
}

export const subjectsApi = {
  list: () => api<SubjectDto[]>("/subjects"),
  create: (input: CreateSubjectInput) =>
    api<SubjectDto>("/subjects", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateSubjectInput) =>
    api<SubjectDto>(`/subjects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    api<void>(`/subjects/${id}`, { method: "DELETE" }),
};
