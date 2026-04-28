import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ResultEntryDto {
  @IsUUID()
  subjectId!: string;

  /** Theory marks obtained (0..theoryFullMarks of the subject). */
  @IsNumber()
  @Min(0)
  @Max(1000)
  theoryMarks!: number;

  /**
   * Practical marks obtained (0..practicalFullMarks).
   * Optional; defaults to 0 for theory-only subjects.
   */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  practicalMarks?: number;
}

export class SaveResultsDto {
  @IsUUID()
  examId!: string;

  @IsUUID()
  studentId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ResultEntryDto)
  entries!: ResultEntryDto[];
}
