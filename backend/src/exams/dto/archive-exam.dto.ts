import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Optional metadata for `POST /exams/:id/archive`.
 *
 * `reason` is shown back in the platform audit feed and the
 * archived-record badge tooltip. Capped at 500 chars to match the
 * `archiveReason` column. Stripped to null when blank so the column
 * never carries an empty string.
 */
export class ArchiveExamDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
