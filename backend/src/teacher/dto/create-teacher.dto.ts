import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateTeacherDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  /**
   * Optionally link the teacher to an existing User account. The service
   * verifies the user belongs to the same school.
   */
  @IsOptional()
  @IsUUID()
  userId?: string;
}
