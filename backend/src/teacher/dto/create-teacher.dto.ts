import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTeacherDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /**
   * Optionally link the teacher to an existing User account. The service
   * verifies the user belongs to the same school.
   */
  @IsOptional()
  @IsUUID()
  userId?: string;

  /**
   * Optional class assignment. A teacher with a classId can mark
   * attendance / enter marks for that class. Null = unassigned (the
   * teacher has read-only access until an admin assigns one).
   */
  @IsOptional()
  @IsUUID()
  classId?: string | null;

  /**
   * Optional narrower section scope. When set, section.classId must
   * equal `classId` — enforced in the service.
   */
  @IsOptional()
  @IsUUID()
  sectionId?: string | null;
}
