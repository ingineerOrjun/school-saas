import {
  IsEmail,
  IsNotEmpty,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * New login shape (replaces the previous email-only flow):
 *   schoolCode + email + password
 *
 * Why three fields:
 *   User.email is now tenant-scoped (`@@unique([schoolId, email])`),
 *   so two different schools may legitimately register an admin
 *   with the same email address. The schoolCode disambiguates which
 *   tenant the credentials belong to.
 *
 * Normalization:
 *   schoolCode is auto-trimmed + uppercased here so the AuthService
 *   never has to second-guess casing differences. The same regex
 *   that SchoolCodeService.validate() enforces on creation also
 *   gates inbound logins — anything malformed is rejected with the
 *   generic `Invalid credentials` message at the service boundary.
 */
export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(40)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  schoolCode!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}
