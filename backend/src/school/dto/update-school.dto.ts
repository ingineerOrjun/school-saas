import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateSchoolDto {
  /**
   * Updated display name. Only this field is editable from the
   * settings UI for now — the slug stays put because it's part of
   * tenant identity and changing it would invalidate URLs.
   */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;
}
