import { PaymentMethod } from '@prisma/client';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreatePaymentDto {
  @IsUUID()
  studentId!: string;

  @IsNumber()
  @Min(0.01)
  @Max(1_000_000)
  amount!: number;

  /** ISO date YYYY-MM-DD. */
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'date must be in YYYY-MM-DD format',
  })
  date!: string;

  /** Optional — link this payment to a specific fee assignment. */
  @IsOptional()
  @IsUUID()
  feeAssignmentId?: string;

  /** Optional payment method for the receipt. */
  @IsOptional()
  @IsEnum(PaymentMethod)
  method?: PaymentMethod;

  /** Optional free-form note for the receipt. */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
