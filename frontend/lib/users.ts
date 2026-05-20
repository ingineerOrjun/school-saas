import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "./api";
import { qk } from "./query-keys";
import type { Role } from "./auth";

export interface UserDto {
  id: string;
  email: string;
  role: Role;
  createdAt: string;
  updatedAt: string;
}

/**
 * Session 6c.2 — soft-delete response shape. Mirrors the backend
 * `DeactivatedUserRow`: every `UserDto` field plus the freshly-set
 * `deletedAt` ISO timestamp. The calling component can read this to
 * confirm the deletion landed and (optionally) tell the user when.
 */
export interface DeactivatedUserDto extends UserDto {
  deletedAt: string;
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
  /**
   * Session 6c.2 — soft-delete. Returns the row with `deletedAt`
   * set. 401 redirects to /login (handled by the api client). 403 /
   * 404 / 409 surface as ApiError with the backend's message; the
   * caller (DeleteUserDialog) decides how to render each.
   */
  softDelete: (id: string) =>
    api<DeactivatedUserDto>(`/users/${id}`, { method: "DELETE" }),
};

/**
 * Session 6c.2 — soft-delete mutation hook. On success, invalidates
 * the canonical `qk.users()` slot so any future `useUsers()` consumer
 * refetches automatically. Today the Settings page still uses an
 * imperative `refresh()` callback; the calling component should
 * trigger that callback from the dialog's `onSuccess` prop.
 *
 * Retry policy: `false` — every failure class is user-actionable
 * (403 = wrong actor, 404 = stale row, 409 = active assignments).
 * Auto-retry would either hide a real refusal or compound it.
 *
 * The hook deliberately omits toasts + modal control: the calling
 * dialog renders inline errors (per spec) and the page renders the
 * success toast.
 */
export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation<DeactivatedUserDto, ApiError, string>({
    mutationFn: (userId) => usersApi.softDelete(userId),
    onSuccess: () => {
      // Wait-and-refresh: tell any users-query subscriber to refetch.
      // No optimistic-remove — the soft-delete is security-sensitive
      // enough that a brief spinner reads more reliably than instant
      // disappearance.
      queryClient.invalidateQueries({ queryKey: qk.users() });
    },
    retry: false,
  });
}
