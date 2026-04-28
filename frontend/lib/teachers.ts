import { api } from "./api";

export interface TeacherDto {
  id: string;
  name: string;
  schoolId: string;
  userId: string | null;
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

export const teachersApi = {
  list: () => api<TeacherDto[]>("/teachers"),
  get: (id: string) => api<TeacherDto>(`/teachers/${id}`),
  create: (input: CreateTeacherInput) =>
    api<TeacherDto>("/teachers", {
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
