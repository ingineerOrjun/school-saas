import {
  IsInt,
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
}
