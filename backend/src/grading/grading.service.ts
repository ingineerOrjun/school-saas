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
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function round(n: number, places: number): number {
  const p = 10 ** places;
  return Math.round(n * p) / p;
}
