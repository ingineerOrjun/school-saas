import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One row in a bulk-marks payload — marks for a single student in the
 * subject the parent DTO names. Subject is intentionally hoisted to
 * the parent so the whole batch represents "this exam × this class ×
 * this subject", which is the actual unit teachers think in.
 */
export class BulkResultEntryDto {
  @IsUUID()
  studentId!: string;

  /** Theory marks obtained (0..theoryFullMarks of the subject). */
  @IsNumber()
  @Min(0)
  @Max(1000)
  theoryMarks!: number;

  /**
   * Practical marks obtained (0..practicalFullMarks).
   * Optional; defaults to 0 server-side for theory-only subjects.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  practicalMarks?: number;
}

/**
 * Payload for `POST /results/bulk-save` — enter marks for an entire
 * class (or section) in one round-trip, all for the same subject.
 *
 *   • subjectId here is an `ExamSubject.id` (per-exam subject row that
 *     carries theory/practical full marks). Same shape as
 *     `SaveResultsDto.entries[].subjectId`.
 *   • sectionId is OPTIONAL: omit (or null) to target the
 *     "no-section" subset of the class, set to a section ID to
 *     target that section.
 */
export class BulkSaveResultsDto {
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
  @Type(() => BulkResultEntryDto)
  entries!: BulkResultEntryDto[];
}
