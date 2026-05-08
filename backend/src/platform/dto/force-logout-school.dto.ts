import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Body for POST /platform/schools/:id/force-logout.
 *
 * Reason is REQUIRED — bulk session evictions are a write that
 * disturbs every user at the tenant; the audit row needs a
 * justification. Single-user force-logout is allowed without a
 * reason (lighter action), so its DTO is separate.
 */
export class ForceLogoutSchoolDto {
  @IsString()
  @MinLength(3, { message: 'Reason must be at least 3 characters.' })
  @MaxLength(500)
  reason!: string;
}
