import { DiscountType } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Edit the discount on an existing assignment. Only `discountType` and
 * `discountValue` are mutable — base amount and due date are intentionally
 * fixed once the fee is assigned (they represent a contractual snapshot
 * and changing them post-hoc would silently invalidate past receipts).
 *
 * Passing `null` for both fields removes the discount; passing one but
 * not the other is rejected in the service layer.
 */
export class UpdateFeeAssignmentDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(DiscountType)
  discountType?: DiscountType | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsNumber()
  @Min(0)
  @Max(1_000_000)
  discountValue?: number | null;
}
