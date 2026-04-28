import { api } from "./api";

export interface SectionDto {
  id: string;
  name: string;
  classId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSectionInput {
  name: string;
  classId: string;
}

export interface UpdateSectionInput {
  name?: string;
}

export const sectionsApi = {
  listByClass: (classId: string) =>
    api<SectionDto[]>(`/sections?classId=${encodeURIComponent(classId)}`),
  create: (input: CreateSectionInput) =>
    api<SectionDto>("/sections", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  update: (id: string, input: UpdateSectionInput) =>
    api<SectionDto>(`/sections/${id}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    api<void>(`/sections/${id}`, { method: "DELETE" }),
};
