// ============================================================================
// SUBJECT_CODE_NAME_ALIASES — frontend mirror of the backend bridge map.
//
// Source of truth: `backend/src/common/auth/teacher-scope.service.ts`
// (search for the const of the same name).
//
// Why this exists:
//   • The CDC curriculum is keyed by `SubjectCode` (enum: NEPALI,
//     ENGLISH, MATHEMATICS, SCIENCE_TECHNOLOGY, SOCIAL_STUDIES,
//     HEALTH_PHYSICAL, ARTS_EDUCATION) — see backend Prisma schema.
//   • A school's `TeachingAssignment.subject` row carries a free-text
//     `Subject.name` (e.g. "English", "Math", "Science and Technology")
//     with no FK to the SubjectCode enum yet.
//   • Until that FK lands, both backend authorization (TeacherScopeService.
//     assertContinuousRecordAccess) and frontend rendering (this file's
//     consumer — the home screen filter) need to bridge by NAME.
//
// Keep this map in lockstep with the backend. If you add an alias here,
// add it there too — the backend is the authoritative gate, and the
// frontend silently hiding a non-CDC card while the backend would have
// authorized the same teacher is a UX bug.
//
// Names are compared case-insensitively + trim-on-input, so the entries
// here are all lowercase. Consumers should `.toLowerCase().trim()` the
// incoming Subject.name before lookup.
// ============================================================================

export type SubjectCode =
  | "NEPALI"
  | "ENGLISH"
  | "MATHEMATICS"
  | "SCIENCE_TECHNOLOGY"
  | "SOCIAL_STUDIES"
  | "HEALTH_PHYSICAL"
  | "ARTS_EDUCATION";

export const SUBJECT_CODE_NAME_ALIASES: Record<SubjectCode, ReadonlyArray<string>> = {
  NEPALI: ["nepali"],
  ENGLISH: ["english"],
  MATHEMATICS: ["mathematics", "math", "maths"],
  SCIENCE_TECHNOLOGY: [
    "science and technology",
    "science & technology",
    "science technology",
    "science",
  ],
  SOCIAL_STUDIES: ["social studies", "social"],
  HEALTH_PHYSICAL: [
    "health and physical education",
    "health & physical education",
    "health and physical",
    "health & physical",
  ],
  ARTS_EDUCATION: ["arts education", "creative arts", "arts", "art"],
};

// Inverse lookup — name → SubjectCode. Computed once at module load.
// O(1) per name lookup; ~25 entries total, so the up-front cost is
// negligible.
const NAME_TO_CODE: Map<string, SubjectCode> = (() => {
  const out = new Map<string, SubjectCode>();
  for (const [code, aliases] of Object.entries(SUBJECT_CODE_NAME_ALIASES) as Array<
    [SubjectCode, ReadonlyArray<string>]
  >) {
    for (const a of aliases) out.set(a, code);
  }
  return out;
})();

/**
 * Resolve a free-text Subject.name to its SubjectCode, or null if the
 * subject isn't part of the CDC curriculum (Music, Computer, Optional
 * Mathematics, etc. — schools carry these in their Subject catalog but
 * they have no CDC outcomes).
 *
 * Comparison is case-insensitive + trim. A `null` return is the home
 * screen's signal to HIDE the assignment card.
 */
export function subjectNameToCode(name: string | null | undefined): SubjectCode | null {
  if (!name) return null;
  return NAME_TO_CODE.get(name.toLowerCase().trim()) ?? null;
}
