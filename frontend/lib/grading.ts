/**
 * NEB grading — client-side mirror of backend GradingService.
 * Kept pure and dependency-free so it can run on every keystroke.
 *
 * The backend is authoritative on save; this function exists for instant
 * preview as the user types marks.
 */

export type LetterGrade =
  | "A_PLUS"
  | "A"
  | "B_PLUS"
  | "B"
  | "C_PLUS"
  | "C"
  | "D"
  | "NG";

export interface GradeResult {
  letterGrade: LetterGrade;
  letterGradeLabel: string;
  gradePoint: number;
  description: string;
}

const GRADE_SCALE: ReadonlyArray<{
  min: number;
  letterGrade: LetterGrade;
  label: string;
  gradePoint: number;
  description: string;
}> = [
  { min: 90, letterGrade: "A_PLUS", label: "A+", gradePoint: 4.0, description: "Outstanding" },
  { min: 80, letterGrade: "A",      label: "A",  gradePoint: 3.6, description: "Excellent" },
  { min: 70, letterGrade: "B_PLUS", label: "B+", gradePoint: 3.2, description: "Very good" },
  { min: 60, letterGrade: "B",      label: "B",  gradePoint: 2.8, description: "Good" },
  { min: 50, letterGrade: "C_PLUS", label: "C+", gradePoint: 2.4, description: "Satisfactory" },
  { min: 40, letterGrade: "C",      label: "C",  gradePoint: 2.0, description: "Acceptable" },
  { min: 35, letterGrade: "D",      label: "D",  gradePoint: 1.6, description: "Partially acceptable" },
  { min: 0,  letterGrade: "NG",     label: "NG", gradePoint: 0.0, description: "Not graded" },
];

export function grade(percentage: number): GradeResult {
  const pct = clamp(percentage, 0, 100);
  const band =
    GRADE_SCALE.find((b) => pct >= b.min) ?? GRADE_SCALE[GRADE_SCALE.length - 1];
  return {
    letterGrade: band.letterGrade,
    letterGradeLabel: band.label,
    gradePoint: band.gradePoint,
    description: band.description,
  };
}

export function percentageFor(marks: number, fullMarks: number): number {
  if (fullMarks <= 0) return 0;
  return clamp((marks / fullMarks) * 100, 0, 100);
}

export function gpa(gradePoints: number[]): number {
  if (gradePoints.length === 0) return 0;
  const sum = gradePoints.reduce((a, b) => a + b, 0);
  return round(sum / gradePoints.length, 2);
}

export function overallGrade(gpaValue: number): GradeResult {
  // Mirror backend: map GPA back onto the percentage scale (×25 → 4.0 ≈ 100).
  return grade(gpaValue * 25);
}

export interface SplitGradeResult extends GradeResult {
  percentage: number;
  theoryPct: number;
  practicalPct: number;
  passesTheory: boolean;
  passesPractical: boolean;
  passes: boolean;
  failedComponent: boolean;
}

/**
 * NEB split grading — the authoritative client-side mirror of the
 * backend's gradeWithSplit. Must pass both theory (≥35%) AND practical
 * (≥35%). Theory-only subjects (`practicalFullMarks === 0`) auto-pass.
 */
export function gradeWithSplit(
  theoryMarks: number,
  theoryFullMarks: number,
  practicalMarks: number,
  practicalFullMarks: number,
): SplitGradeResult {
  const theoryPct =
    theoryFullMarks > 0 ? clamp((theoryMarks / theoryFullMarks) * 100, 0, 100) : 0;
  const practicalPct =
    practicalFullMarks > 0
      ? clamp((practicalMarks / practicalFullMarks) * 100, 0, 100)
      : 100;
  const passesTheory = theoryPct >= 35;
  const passesPractical = practicalFullMarks === 0 || practicalPct >= 35;
  const passes = passesTheory && passesPractical;

  const totalFull = theoryFullMarks + practicalFullMarks;
  const totalMarks = theoryMarks + practicalMarks;
  const percentage =
    totalFull > 0 ? clamp((totalMarks / totalFull) * 100, 0, 100) : 0;

  if (!passes) {
    return {
      percentage,
      letterGrade: "NG",
      letterGradeLabel: "NG",
      gradePoint: 0,
      description: "Not graded — failed a component",
      theoryPct,
      practicalPct,
      passesTheory,
      passesPractical,
      passes,
      failedComponent: true,
    };
  }

  const g = grade(percentage);
  return {
    percentage,
    ...g,
    theoryPct,
    practicalPct,
    passesTheory,
    passesPractical,
    passes,
    failedComponent: false,
  };
}

export const gradeScale = GRADE_SCALE;

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round(n: number, places: number): number {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}

/**
 * Credit-hour-weighted GPA — client-side mirror of the backend
 * GradingService.calculateWeightedGPA. Used for instant preview as the
 * teacher types marks; the backend remains authoritative on save.
 *
 * Returns null when:
 *   • the input is empty, or
 *   • any subject is NG / has no grade point yet (per NEB rule, ANY NG
 *     = overall NG — surfaced as null so the UI renders "NG" instead
 *     of a misleading averaged number).
 *
 * Coexists with the legacy `gpa(gradePoints)` above; that one is a
 * simple arithmetic mean and remains for callers that haven't moved to
 * the weighted formula yet.
 */
export function calculateWeightedGPA(
  results: Array<{
    gradePoint: number | null | undefined;
    creditHours: number | null | undefined;
    letterGrade: string | null | undefined;
  }>,
): number | null {
  if (!results || results.length === 0) return null;
  const hasNG = results.some(
    (r) => !r.letterGrade || r.letterGrade === "NG" || r.gradePoint == null,
  );
  if (hasNG) return null;
  const totalCredits = results.reduce(
    (sum, r) => sum + (r.creditHours ?? 5),
    0,
  );
  if (totalCredits === 0) return null;
  const weightedSum = results.reduce(
    (sum, r) => sum + (r.gradePoint as number) * (r.creditHours ?? 5),
    0,
  );
  return Math.round((weightedSum / totalCredits) * 100) / 100;
}

/**
 * Maps a computed GPA to a letter grade — the official CDC overall-GPA
 * mapping (3.6 → A+, 3.2 → A, ...). Intentionally different from the
 * per-subject `grade(percentage)` scale: those agree at the endpoints
 * but diverge in the middle bands.
 */
export function gpaToLetterGrade(gpa: number | null | undefined): string {
  if (gpa == null) return "NG";
  if (gpa >= 3.6) return "A+";
  if (gpa >= 3.2) return "A";
  if (gpa >= 2.8) return "B+";
  if (gpa >= 2.4) return "B";
  if (gpa >= 2.0) return "C+";
  if (gpa >= 1.6) return "C";
  if (gpa >= 1.2) return "D";
  return "NG";
}
