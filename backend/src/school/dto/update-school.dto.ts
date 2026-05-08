import {
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateSchoolDto {
  /**
   * Updated display name. The slug stays put because it's part of
   * tenant identity and changing it would invalidate URLs.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  /**
   * Free-form postal address shown on receipts and other printable
   * artifacts. Empty string is treated as "clear" (stored as null) so
   * admins can drop a previously-set value without a separate endpoint.
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  @MaxLength(240)
  address?: string | null;

  /**
   * Public phone number — kept as a string (not parsed) so country code
   * + local format are admin-controlled. Empty string clears.
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null && v !== '')
  @IsString()
  @MaxLength(40)
  phone?: string | null;
}
