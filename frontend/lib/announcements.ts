import { api } from "./api";

/**
 * School-wide announcement. Admin writes; everyone in the school
 * reads. Newest-first feed served from the
 * `(schoolId, createdAt)` composite index on the backend.
 */
export interface AnnouncementDto {
  id: string;
  title: string;
  message: string;
  schoolId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAnnouncementInput {
  title: string;
  message: string;
}

export const announcementsApi = {
  /**
   * List announcements. Backend strict-defaults to the active
   * session — pass an explicit `sessionId` to view a previous
   * year's notices.
   */
  list: (sessionId?: string) => {
    const qs = sessionId
      ? `?sessionId=${encodeURIComponent(sessionId)}`
      : "";
    return api<AnnouncementDto[]>(`/announcements${qs}`);
  },
  create: (input: CreateAnnouncementInput) =>
    api<AnnouncementDto>("/announcements", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    api<void>(`/announcements/${id}`, { method: "DELETE" }),
};
