import { Type } from 'class-transformer';
import { SubjectCode } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

// ============================================================================
// ListContinuousRecordDto
//
// Query parameters for GET /continuous-records. studentId + sessionId
// are required because the table is large enough that an unqualified
// list would be pointless — the read surface is always "what does this
// student look like in this academic year".
//
// Optional filters: subjectCode (filter by LearningOutcome.subjectCode)
// and classLevel (filter by LearningOutcome.classLevel). Either can be
// inferred by the caller from the student's class but both are exposed
// so the report-card UI (future) can pull "just this subject" without
// loading every outcome the student was rated on.
//
// @Type(() => Number) is required for classLevel because @Query() values
// arrive as strings; @IsInt without the transform fails on any input.
// ============================================================================
export class ListContinuousRecordDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  sessionId!: string;

  @IsOptional()
  @IsEnum(SubjectCode)
  subjectCode?: SubjectCode;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  classLevel?: number;
}
