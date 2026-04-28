import { DiscountType } from '@prisma/client';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  Min,
} from 'class-validator';

export class AssignFeeDto {
  @IsUUID()
  feeStructureId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID(undefined, { each: true })
  studentIds!: string[];

  /** ISO date YYYY-MM-DD. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dueDate must be in YYYY-MM-DD format',
  })
  dueDate!: string;

  /**
   * Optional scholarship / discount. When provided, both `discountType`
   * and `discountValue` must be present — the service rejects one
   * without the other. The same discount is applied uniformly to every
   * student in `studentIds` for this assignment.
   */
  @IsOptional()
  @IsEnum(DiscountType)
  discountType?: DiscountType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  discountValue?: number;
}
