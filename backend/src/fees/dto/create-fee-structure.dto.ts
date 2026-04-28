import { FeeFrequency } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateFeeStructureDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  amount!: number;

  @IsEnum(FeeFrequency)
  frequency!: FeeFrequency;

  /**
   * Optional class scope. When set, only students in that class may have
   * this fee assigned to them. Leave null for a school-wide fee.
   */
  @IsOptional()
  @IsUUID()
  classId?: string | null;
}
