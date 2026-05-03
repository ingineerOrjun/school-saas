import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateAcademicSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(40)
  name!: string;

  @IsDateString()
  startDate!: string;

  @IsDateString()
  endDate!: string;

  /**
   * If true, this session becomes the active one and any other
   * active session for the school is flipped to false in the same
   * transaction. Default false — admins use the dedicated `setActive`
   * endpoint when they want to switch.
   */
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
