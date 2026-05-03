import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { StudentSessionStatus } from '@prisma/client';

/**
 * One row in a promotion payload — what happens to a single student
 * at the end of the academic year. Admins compute this client-side
 * (typically per current class) and submit the full list together.
 */
export class PromotionEntryDto {
  @IsUUID()
  studentId!: string;

  @IsEnum(StudentSessionStatus)
  status!: StudentSessionStatus;

  /**
   * Required when `status === PROMOTED`. The class the student rolls
   * into for the new session. Ignored for RETAINED (student keeps
   * current class) and LEFT (no class change).
   */
  @IsOptional()
  @IsUUID()
  nextClassId?: string;

  /**
   * Optional new section under `nextClassId`. Section assignments
   * usually shuffle at year-start, so most schools leave this null
   * and re-assign sections later via the Students page.
   */
  @IsOptional()
  @IsUUID()
  nextSectionId?: string;
}

/**
 * The new academic session to create after the promotion runs. The
 * promotion endpoint creates this session and marks it active in the
 * same transaction as the academic-record snapshots.
 */
export class NextSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;
}

/**
 * Full promotion payload. Atomic — the whole operation either
 * completes (snapshots + class moves + new session created) or
 * rolls back. Prevents half-promoted state.
 */
export class RunPromotionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PromotionEntryDto)
  entries!: PromotionEntryDto[];

  @ValidateNested()
  @Type(() => NextSessionDto)
  nextSession!: NextSessionDto;
}
