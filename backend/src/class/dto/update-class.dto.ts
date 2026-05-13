import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateClassDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  /**
   * Phase FINAL-HARDENING Part 2: optimistic-concurrency stamp.
   * Optional during rollout — see `common/db/optimistic-update.ts`.
   */
  @IsOptional()
  @IsDateString()
  updatedAt?: string;
}
