import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

// ============================================================================
// ListPortfolioItemsDto — GET /portfolio-items
//
// studentId + sessionId are required because the unfiltered list would
// span every student in the school (and every prior year), which is
// pointless for the report-card / portfolio-viewer surfaces this
// endpoint backs.
//
// `outcomeId` is `@IsString()` — same cuid rationale as the create DTO.
//
// `limit` defaults to 50 and caps at 200; `offset` defaults to 0 and
// rejects negatives. `@Type(() => Number)` is required because @Query
// values arrive as strings; without the coercion `@IsInt` rejects
// every input.
// ============================================================================
export class ListPortfolioItemsDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  sessionId!: string;

  @IsOptional()
  @IsString()
  outcomeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
