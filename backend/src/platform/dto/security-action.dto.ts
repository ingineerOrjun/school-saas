import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for the per-user security actions:
 *   • POST /platform/users/:id/force-logout
 *   • POST /platform/users/:id/reset-password
 *
 * Reason is OPTIONAL but recommended — single-user actions are
 * narrower than the school-wide hammer, so we don't reject empty
 * bodies. The audit row carries whatever the operator provides.
 */
export class SecurityActionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
