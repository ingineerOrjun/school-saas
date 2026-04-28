import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateStudentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  lastName!: string;

  /**
   * Nepal-style Symbol / Roll number. Unique within a school when present.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  symbolNumber?: string | null;

  /**
   * Optionally link the student to an existing User account. The service
   * verifies the user belongs to the same school.
   */
  @IsOptional()
  @IsUUID()
  userId?: string;

  /**
   * Optionally assign the student to a class. When set, the service verifies
   * the class belongs to the same school. A class assignment is independent
   * of section — small schools may use classes without sections — but if
   * both are provided, the section's classId must match.
   */
  @IsOptional()
  @IsUUID()
  classId?: string | null;

  /**
   * Optionally assign the student to a section. The service verifies the
   * section's class belongs to the same school, and — if `classId` is also
   * provided — that the section lives under that class.
   */
  @IsOptional()
  @IsUUID()
  sectionId?: string | null;
}
