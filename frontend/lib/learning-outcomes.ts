import { useQuery } from "@tanstack/react-query";
import { api, isNetworkError } from "./api";
import { qk } from "./query-keys";
import type { SubjectCode } from "./subject-aliases";

// ============================================================================
// learning-outcomes — typed client for GET /learning-outcomes.
//
// Backend contract (read backend/src/learning-outcome/learning-outcome.
// controller.ts for the source of truth):
//
//   GET /learning-outcomes?classLevel=<n>&subject=<SubjectCode>
//     [&curriculumVersion=<BS-year>]
//     [&unitNumber=<n>]
//
//   • classLevel + subject are REQUIRED. The controller throws 400
//     when either is missing.
//   • Returns a FLAT array of LearningOutcome rows, ordered by
//     unitNumber then sortOrder. The UI groups by unitNumber + skill
//     itself — no nested response shape.
//   • Empty array (not 404) when nothing is seeded for the (class,
//     subject) pair. The home screen filter already hides assignments
//     for subjects with no seeds.
//   • Feature-gated behind `conEvaluation` — disabled schools 403.
//
// Cache shape:
//   • Curriculum data changes only on backend seed runs (months
//     apart in practice). 30m staleTime + 60m gcTime keeps the
//     units-overview and unit-view screens from re-fetching as the
//     teacher drills in/out of the same class.
//   • retry: 1 — curriculum SHOULD be available; if it isn't,
//     surface fast rather than spin on 5xx.
//   • refetchOnMount: false — we don't refetch when the teacher
//     navigates back; the cache is the cheaper read.
// ============================================================================

export type SkillArea =
  | "LISTENING"
  | "SPEAKING"
  | "READING"
  | "WRITING"
  | "VOCABULARY"
  | "LANGUAGE_STRUCTURE"
  | "CONTENT_AREA";

/** One row from `GET /learning-outcomes`. Mirrors Prisma's
 *  `LearningOutcome` model. */
export interface LearningOutcomeDto {
  id: string;
  classLevel: number;
  subjectCode: SubjectCode;
  curriculumVersion: string;
  unitNumber: number;
  unitTitleEn: string | null;
  unitTitleNp: string | null;
  sortOrder: number;
  skillArea: SkillArea;
  descriptionEn: string | null;
  descriptionNp: string | null;
  createdAt: string;
}

function buildQuery(classLevel: number, subject: string): string {
  const params = new URLSearchParams();
  params.set("classLevel", String(classLevel));
  params.set("subject", subject);
  return params.toString();
}

export const learningOutcomesApi = {
  list: (classLevel: number, subject: string) =>
    api<LearningOutcomeDto[]>(
      `/learning-outcomes?${buildQuery(classLevel, subject)}`,
      // 403 on the conEvaluation flag should NOT log the teacher out —
      // it's a feature-flag rejection, not an auth failure. Surface as
      // a thrown ApiError; the page-level FeatureGate handles it.
      { redirectOn403: false },
    ),
};

export function useLearningOutcomesByClassAndSubject(
  classLevel: number,
  subject: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: qk.learningOutcomes(classLevel, subject),
    queryFn: () => learningOutcomesApi.list(classLevel, subject),
    // Default to true if the consumer didn't specify, but allow
    // skipping when the upstream params aren't ready yet (e.g. the
    // home page hasn't resolved the assignment yet).
    enabled: options?.enabled ?? true,
    staleTime: 30 * 60 * 1000, // 30 min — near-static curriculum
    gcTime: 60 * 60 * 1000, // 60 min
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: (failureCount, error) => {
      // Network failure — surface fast.
      if (isNetworkError(error)) return false;
      const status = (error as { status?: number } | null)?.status;
      // 401 → already redirected by api.ts. 403 → feature flag off,
      // retry is pointless. 400/404 → caller error, also pointless.
      if (status === 401 || status === 403) return false;
      if (status && status >= 400 && status < 500) return false;
      return failureCount < 1;
    },
  });
}
