import { api } from "./api";
import type { Role } from "./auth";

export interface UserDto {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateUserRoleInput {
  role: Role;
}

export const usersApi = {
  list: () => api<UserDto[]>("/users"),
  updateRole: (id: string, input: UpdateUserRoleInput) =>
    api<UserDto>(`/users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
};
