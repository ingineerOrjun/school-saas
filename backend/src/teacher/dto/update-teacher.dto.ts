import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

/**
 * Edit-teacher payload. After the legacy column drop in 20260511,
 * editing a teacher only touches the profile (`name`) and, in rare
 * remediation cases, the linked `userId`. Class/section/subject
 * assignment is exclusively managed through the AssignmentsDialog
 * grid (POST /teachers/:id/assignments/bulk).
 */
export class UpdateTeacherDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;
}
