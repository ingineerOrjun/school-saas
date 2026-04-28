import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
} from 'class-validator';

export class ReportQueryDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'fromDate must be in YYYY-MM-DD format',
  })
  fromDate!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'toDate must be in YYYY-MM-DD format',
  })
  toDate!: string;

  @IsOptional()
  @IsUUID()
  studentId?: string;

  @IsOptional()
  @IsUUID()
  sectionId?: string;

  /**
   * Whole-class scope (students assigned directly to a class with no
   * section). Mirrors the roster endpoint so insights work for schools
   * that don't use sections.
   */
  @IsOptional()
  @IsUUID()
  classId?: string;
}
