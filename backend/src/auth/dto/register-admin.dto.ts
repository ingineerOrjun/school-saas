import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/;

export class RegisterAdminDto {
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

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  schoolName!: string;

  /**
   * Optional public school code. When present, AuthService validates
   * the format (`^[A-Z0-9-]+$`, 3-40 chars) and rejects duplicates.
   * When omitted, SchoolCodeService auto-generates the next default
   * code (SCH-NNNN). Always normalized (trim + uppercase) before the
   * uniqueness check.
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(40)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  schoolCode?: string;
}
