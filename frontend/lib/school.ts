import { api } from "./api";

export interface SchoolDto {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateSchoolInput {
  name?: string;
}

export const schoolApi = {
  get: () => api<SchoolDto>("/school"),
  update: (input: UpdateSchoolInput) =>
    api<SchoolDto>("/school", {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
};
