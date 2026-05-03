import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Same complexity rule as RegisterAdminDto so admin-provisioned teacher
// passwords meet the same bar as self-registered admins.
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

/**
 * Payload for the "create teacher login in one step" flow used by the
 * Add Teacher dialog. The endpoint creates a User row (role=TEACHER) AND
 * a Teacher row in a single transaction, links them, and optionally
 * assigns a class/section.
 */
export class CreateTeacherWithUserDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(PASSWORD_PATTERN, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, and one number.',
  })
  password!: string;

  @IsOptional()
  @IsUUID()
  classId?: string | null;

  @IsOptional()
  @IsUUID()
  sectionId?: string | null;
}
