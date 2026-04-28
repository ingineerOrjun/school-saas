import { api } from "./api";
import type { SectionDto } from "./sections";

export interface ClassDto {
  id: string;
  name: string;
  schoolId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClassWithSections extends ClassDto {
  sections: SectionDto[];
}

export interface CreateClassInput {
  name: string;
}

export interface UpdateClassInput {
  name?: string;
}

export const classesApi = {
  list: () => api<ClassWithSections[]>("/classes"),
  create: (input: CreateClassInput) =>
    api<ClassDto>("/classes", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateClassInput) =>
    api<ClassDto>(`/classes/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    api<void>(`/classes/${id}`, { method: "DELETE" }),
};
