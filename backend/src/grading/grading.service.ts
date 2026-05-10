import { Injectable } from '@nestjs/common';
import { LetterGrade } from '@prisma/client';

export interface GradeResult {
  letterGrade: LetterGrade;
  /** Human-readable label: "A+", "A", "B+", etc. */
  letterGradeLabel: string;
  gradePoint: number;
  description: string;
}

/**
 * NEB grading scale — bands sorted high-to-low. A percentage matches the
 * first band where `pct >= min`, making boundary behavior unambiguous
 * (89.99 → A, 90 → A+).
 */
const GRADE_SCALE: ReadonlyArray<{
  min: number;
  letterGrade: LetterGrade;
  label: string;
  gradePoint: number;
  description: string;
}> = [
  { min: 90, letterGrade: LetterGrade.A_PLUS, label: 'A+', gradePoint: 4.0, description: 'Outstanding' },
  { min: 80, letterGrade: LetterGrade.A,      label: 'A',  gradePoint: 3.6, description: 'Excellent' },
  { min: 70, letterGrade: LetterGrade.B_PLUS, label: 'B+', gradePoint: 3.2, description: 'Very good' },
  { min: 60, letterGrade: LetterGrade.B,      label: 'B',  gradePoint: 2.8, description: 'Good' },
  { min: 50, letterGrade: LetterGrade.C_PLUS, label: 'C+', gradePoint: 2.4, description: 'Satisfactory' },
  { min: 40, letterGrade: LetterGrade.C,      label: 'C',  gradePoint: 2.0, description: 'Acceptable' },
  { min: 35, letterGrade: LetterGrade.D,      label: 'D',  gradePoint: 1.6, description: 'Partially acceptable' },
  { min: 0,  letterGrade: LetterGrade.NG,     label: 'NG', gradePoint: 0.0, description: 'Not graded' },
];

@Injectable()
export class GradingService {
  /** Map a percentage (0–100) to a NEB letter grade + grade point. */
  grade(percentage: number): GradeResult {
    const pct = clamp(percentage, 0, 100);
    const band = GRADE_SCALE.find((b) => pct >= b.min) ?? GRADE_SCALE[GRADE_SCALE.length - 1];
    return {
      letterGrade: band.letterGrade,
      letterGradeLabel: band.label,
      gradePoint: band.gradePoint,
      description: band.description,
    };
  }

  /** Convert raw marks + full marks into a percentage. */
  percentage(marks: number, fullMarks: number): number {
    if (fullMarks <= 0) return 0;
    return clamp((marks / fullMarks) * 100, 0, 100);
  }

  /**
   * GPA from a list of grade points — simple arithmetic mean.
   * NG (0.0) is included as-is per the spec ("treat as 0.0").
   * Credit hours are deliberately NOT applied yet.
   */
  gpa(gradePoints: number[]): number {
    if (gradePoints.length === 0) return 0;
    const sum = gradePoints.reduce((a, b) => a + b, 0);
    return round(sum / gradePoints.length, 2);
  }

  /** Expose the scale so UIs can render it as a legend if desired. */
  getScale() {
    return GRADE_SCALE;
  }

  /**
   * Calculates credit-hour-weighted GPA per the Nepal CDC progress-report
   * formula:
   *   GPA = Σ(gradePoint_i × creditHours_i) / Σ(creditHours_i)
   *
   * Returns null when:
   *   • the input is empty (nothing to summarize), or
   *   • any subject is graded NG (per NEB rule, ANY NG = overall NG —
   *     surfaced as null so the caller can render "NG" rather than a
   *     misleading averaged number).
   *
   * Coexists with the legacy `gpa(gradePoints)` method above; that one
   * is kept for any caller that hasn't been migrated yet to the weighted
   * formula.
   */
  calculateWeightedGPA(
    results: Array<{
      gradePoint: number | null;
      creditHours: number;
      letterGrade: string;
    }>,
  ): number | null {
    if (!results || results.length === 0) return null;
    // One NG = entire result is NG.
    const hasNG = results.some(
      (r) => r.letterGrade === 'NG' || r.gradePoint === null,
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
    const gpa = weightedSum / totalCredits;
    return Math.round(gpa * 100) / 100; // 2 decimal places
  }

  /**
   * Maps a computed GPA number directly to a letter grade — the official
   * CDC overall-GPA mapping, NOT the per-subject percentage scale.
   *
   * Important: this is intentionally different from `grade(percentage)`.
   * The per-subject scale maps marks → letter at the boundaries
   * (90% → A+); this maps the GPA range itself (3.6 → A+). The two
   * agree at endpoints but diverge in the middle bands.
   */
  gpaToLetterGrade(gpa: number | null): string {
    if (gpa === null) return 'NG';
    if (gpa >= 3.6) return 'A+';
    if (gpa >= 3.2) return 'A';
    if (gpa >= 2.8) return 'B+';
    if (gpa >= 2.4) return 'B';
    if (gpa >= 2.0) return 'C+';
    if (gpa >= 1.6) return 'C';
    if (gpa >= 1.2) return 'D';
    return 'NG';
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round(n: number, places: number): number {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}
