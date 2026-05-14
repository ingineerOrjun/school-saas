import { EvalPhase } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// ============================================================================
// CreateContinuousRecordDto
//
// Payload for POST /continuous-records (single) AND for each element of
// POST /continuous-records/bulk. The two endpoints share this DTO so a
// single rating shape is enforced everywhere — there's no "loose" form.
//
// `outcomeId` is `@IsString()` (not `@IsUUID()`) because LearningOutcome
// uses `@default(cuid())`, not UUID. Migrating LearningOutcome.id to
// UUID is out of scope for this session — see schema.prisma comment on
// `model ContinuousRecord`.
//
// `expectedUpdatedAt` is optional. When present, the service compares
// it against the stored row's updatedAt INSIDE the transaction and
// fails the whole call with CONCURRENT_MODIFICATION if it doesn't match.
// Callers should round-trip the value from the most recent GET; absence
// is a deliberate opt-out for first-write callers.
// ============================================================================
export class CreateContinuousRecordDto {
  @IsUUID()
  studentId!: string;

  /** LearningOutcome.id — cuid, NOT uuid. See class header. */
  @IsString()
  outcomeId!: string;

  @IsUUID()
  sessionId!: string;

  @IsEnum(EvalPhase)
  phase!: EvalPhase;

  @IsInt()
  @Min(1)
  @Max(4)
  rating!: number;

  /** Optional teacher remarks (CDC's "कैफियत" column). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /**
   * Optimistic-concurrency guard. When present, the existing row's
   * updatedAt MUST equal this value; otherwise the call (or, in bulk,
   * the entire batch) rejects with code CONCURRENT_MODIFICATION.
   */
  @IsOptional()
  @IsDateString()
  expectedUpdatedAt?: string;
}
