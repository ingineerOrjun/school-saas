import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body for PATCH /platform/schools/:id/maintenance.
 *
 * Reason is OPTIONAL — toggling maintenance mode is reversible and
 * lower-stakes than a SUSPENDED transition. The platform UI captures
 * a reason anyway (free-form note); the audit row carries whatever
 * was provided.
 */
export class SetMaintenanceModeDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
