import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

// ============================================================================
// UpdatePortfolioItemDto — PATCH /portfolio-items/:id
//
// Description-only. The DTO declares EXACTLY one field, and the global
// `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true })`
// configured in main.ts rejects any other property in the request
// body with a 400. This is how the spec's "Reject any request body
// field other than `description`" rule is enforced — no per-method
// pipe needed, no manual key-checking in the service.
//
// Anything that touches `type`, `occurredOn`, `studentId`, `sessionId`,
// `outcomeId`, `fileUrl`, or `schoolId` MUST go through a separate
// admin-grade endpoint that doesn't exist yet (out of scope for
// Session 4). Teachers literally cannot reshape those columns via
// this DTO.
// ============================================================================
export class UpdatePortfolioItemDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;
}
