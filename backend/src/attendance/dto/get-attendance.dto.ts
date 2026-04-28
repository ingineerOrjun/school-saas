import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

/**
 * Roster query — accepts either a `sectionId` (traditional flow) OR a
 * `classId` (small schools that track attendance at the class level with
 * no sections). The service rejects requests that supply neither.
 */
export class GetAttendanceQueryDto {
  /** ISO date in YYYY-MM-DD format. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be in YYYY-MM-DD format',
  })
  date!: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  @IsOptional()
  @IsUUID()
  classId?: string;
}
