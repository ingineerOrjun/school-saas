import { SchoolStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSchoolStatusDto {
  @IsEnum(SchoolStatus)
  status!: SchoolStatus;

  /**
   * Audit reason. Required server-side when transitioning to
   * SUSPENDED or EXPIRED — the service enforces that rule with a
   * clearer message than a class-validator constraint could carry.
   * Optional here so reactivations (back to ACTIVE) don't force a
   * meaningless reason.
   */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
