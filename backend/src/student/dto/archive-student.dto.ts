import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Optional metadata for `POST /students/:id/archive`.
 *
 * `reason` is shown back in the platform audit feed and the
 * archived-record badge tooltip. Capped at 500 chars to match the
 * `archiveReason` column. Stripped to null when blank so the column
 * never carries an empty string.
 */
export class ArchiveStudentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
