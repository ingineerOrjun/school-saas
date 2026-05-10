import {
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateSubjectDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  /** Required. Theory component full marks (1–1000). */
  @IsInt()
  @Min(1)
  @Max(1000)
  theoryFullMarks!: number;

  /**
   * Optional. Practical component full marks (0–1000).
   * 0 means theory-only — practical is auto-passed when grading.
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  practicalFullMarks?: number;

  /**
   * Optional. Credit hours used to weight this subject in the
   * credit-hour-weighted GPA (per Nepal CDC progress-report formula).
   * Defaults to 5 — the most common CDC weekly-period allocation —
   * matching the database default. Range covers half-credits up to
   * intensive blocks.
   */
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(20)
  creditHours?: number = 5;
}
