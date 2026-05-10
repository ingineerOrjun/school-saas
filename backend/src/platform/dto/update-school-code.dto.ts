import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Payload for the SUPER_ADMIN endpoint that changes a school's
 * public schoolCode after creation. Auto-uppercased + trimmed; the
 * SchoolCodeService also validates the regex (`^[A-Z0-9-]+$`) and
 * the uniqueness against other schools.
 *
 * `reason` is free-form copy stored on the audit trail row.
 */
export class UpdateSchoolCodeDto {
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  schoolCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
