import { PaymentMethod } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';

/**
 * Payment edits are narrowly scoped — only non-financial annotations
 * (notes, method) are truly mutable. `feeAssignmentId` appears on the
 * DTO so the service can enforce the "credit stays credit" immutability
 * rule with a clear error message, but the service will never write it
 * back to the DB from this endpoint. Amount, date, and the receipt
 * number are intentionally NOT on this DTO: they're frozen snapshots
 * of the original transaction.
 */
export class UpdatePaymentDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(500)
  notes?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsEnum(PaymentMethod)
  method?: PaymentMethod | null;

  /**
   * Present only so the service can 400 on an attempt to link a
   * General Credit payment to a specific fee. Never persisted.
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  feeAssignmentId?: string | null;
}
