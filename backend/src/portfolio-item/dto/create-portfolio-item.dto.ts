import { Transform } from 'class-transformer';
import { PortfolioItemType } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// ============================================================================
// CreatePortfolioItemDto — POST /portfolio-items
//
// Validation lives at three layers:
//   • This DTO (synchronous, request-shape).
//   • PortfolioItemService.create (semantic: tenant, session lock,
//     teacher scope, occurredOn ≤ today AND ≥ session.startDate).
//   • DB (FK constraints, NOT NULL columns).
//
// outcomeId is `@IsString()` rather than `@IsUUID()` because
// LearningOutcome.id is `cuid()` — same precedent as
// `CreateContinuousRecordDto.outcomeId`. Validating as UUID here would
// reject every legitimate request.
// ============================================================================
export class CreatePortfolioItemDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  sessionId!: string;

  /** LearningOutcome.id — cuid, NOT uuid. Optional: portfolio items
   *  can record general observations not tied to a specific outcome. */
  @IsOptional()
  @IsString()
  outcomeId?: string;

  @IsEnum(PortfolioItemType)
  type!: PortfolioItemType;

  /**
   * Free-form caption. We trim first (so `"   "` becomes `""`) then
   * enforce 1..2000. `@Transform` runs before `@MinLength`, so a
   * whitespace-only submission gets a clean validation error instead
   * of slipping through as a 3-char "valid" string.
   */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  /**
   * ISO date string (YYYY-MM-DD or full ISO). Service-layer enforces
   * the temporal envelope (≥ session.startDate, ≤ today) — we don't
   * try to do it here because `IsDateString` has no notion of either
   * boundary and the service already needs the AcademicSession row
   * anyway for the lock check.
   */
  @IsDateString()
  occurredOn!: string;

  /**
   * Optional already-uploaded URL. Must start with `https://` so a
   * teacher cannot store an unprotected http:// link (insecure mixed
   * content from the frontend, sniffable on shared school WiFi).
   * Cap of 2048 matches Chrome's URL limit and rejects accidental
   * paste-of-base64 payloads.
   */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^https:\/\/.+/, {
    message: 'fileUrl must be a complete https:// URL',
  })
  fileUrl?: string;
}
