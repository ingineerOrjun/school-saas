import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Same complexity rule as RegisterAdminDto so admin-provisioned teacher
// passwords meet the same bar as self-registered admins.
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

/**
 * Payload for the "create teacher login in one step" flow used by the
 * Add Teacher dialog. The endpoint creates a User row (role=TEACHER)
 * AND a Teacher row in a single transaction and links them.
 *
 * Class/section assignment is NOT part of this DTO any more — the
 * legacy `Teacher.classId/sectionId` columns were dropped, and the
 * only path to assignments is the AssignmentsDialog grid (POST
 * /teachers/:id/assignments/bulk). The login hard-guard rejects
 * teacher logins until at least one assignment exists, so the admin
 * UX is: create teacher → assign immediately → teacher signs in.
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
}
