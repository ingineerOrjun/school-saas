import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateExamDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  /**
   * Phase FINAL-HARDENING Part 2: optimistic-concurrency stamp.
   * Optional during rollout — see `assertNotStaleAndUpdate` in
   * `common/db/optimistic-update.ts`.
   */
  @IsOptional()
  @IsDateString()
  updatedAt?: string;
}
