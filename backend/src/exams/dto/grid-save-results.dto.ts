import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One row in the marks-entry grid — a single student's result for
 * the subject the parent DTO names. Simpler shape than
 * `BulkResultEntryDto`: a single `obtainedMarks` number (mapped to
 * theoryMarks server-side) plus an `absent` flag, so the grid UX
 * stays a "type a number / tick a box" interaction.
 */
export class GridResultEntryDto {
  @IsUUID()
  studentId!: string;

  /**
   * Marks obtained — null when the field is intentionally blank
   * (no result entered yet) AND `absent` is false. The server
   * skips blank-not-absent rows during the upsert pass instead of
   * writing a 0 (typing `Tab` past a row shouldn't auto-fail it).
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  obtainedMarks?: number | null;

  /**
   * True when the student is being marked absent for this subject.
   * Forces marks to 0 and grade to NG regardless of `obtainedMarks`.
   */
  @IsOptional()
  @IsBoolean()
  absent?: boolean;
}

/**
 * Payload for `POST /results/grid-save` — the simpler bulk path used
 * by the marks-entry grid at `/exams/marks-entry`. Same scope rule
 * (one exam × one class × one subject across many students) as
 * `BulkSaveResultsDto`, but the row shape is flatter so a teacher can
 * type a column of numbers without thinking about theory/practical.
 *
 *   • subjectId — `ExamSubject.id`. The grid only supports
 *     theory-only subjects (practicalFullMarks = 0); subjects with
 *     a practical component require the per-student endpoint.
 *   • sectionId — null/omitted → "no-section" subset of the class;
 *     set → only that section.
 *   • marks — one entry per student in the rendered grid. Empty
 *     non-absent rows are SKIPPED, not zeroed.
 */
export class GridSaveResultsDto {
  @IsUUID()
  examId!: string;

  @IsUUID()
  classId!: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string | null;

  @IsUUID()
  subjectId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => GridResultEntryDto)
  marks!: GridResultEntryDto[];
}
