import { api } from "./api";

/**
 * Promotion = "close the year, roll students forward, open the next
 * year". Atomic on the backend — every change for every student plus
 * the new-session creation is one transaction. UI-side, this just
 * means the call either fully succeeds (school is in the new year)
 * or fully fails (no rows touched).
 *
 * Preconditions enforced server-side:
 *   • Active session must exist.
 *   • Active session must be LOCKED (admin clicks Lock first).
 */

export type StudentSessionStatus = "PROMOTED" | "RETAINED" | "LEFT";

export interface PromotionEntryInput {
  studentId: string;
  status: StudentSessionStatus;
  /** Required when status === "PROMOTED". */
  nextClassId?: string;
  /** Optional new section under nextClassId. */
  nextSectionId?: string;
}

export interface NextSessionInput {
  name: string;
  startDate: string;
  endDate: string;
}

export interface RunPromotionInput {
  entries: PromotionEntryInput[];
  nextSession: NextSessionInput;
}

export interface PromotionResult {
  fromSessionId: string;
  fromSessionName: string;
  toSessionId: string;
  toSessionName: string;
  counts: {
    promoted: number;
    retained: number;
    left: number;
    total: number;
  };
}

/** One row of a student's session-by-session class history. */
export interface StudentAcademicRecordDto {
  id: string;
  studentId: string;
  sessionId: string;
  session: { id: string; name: string };
  classId: string;
  class: { id: string; name: string };
  sectionId: string | null;
  section: { id: string; name: string } | null;
  schoolId: string;
  status: StudentSessionStatus;
  createdAt: string;
  updatedAt: string;
}

export const promotionApi = {
  /**
   * Run the full promotion. Backend rejects if the active session
   * isn't locked or if the payload is internally inconsistent
   * (PROMOTED entries missing nextClassId, sections that don't
   * belong to the chosen class, etc.).
   */
  run: (input: RunPromotionInput) =>
    api<PromotionResult>("/promotion/run", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  /** History — one row per session for a single student. */
  studentHistory: (studentId: string) =>
    api<StudentAcademicRecordDto[]>(
      `/promotion/students/${encodeURIComponent(studentId)}/history`,
    ),
};
