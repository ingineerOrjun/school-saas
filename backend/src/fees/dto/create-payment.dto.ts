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

  // `maxDecimalPlaces: 2` rejects `100.005`-style submissions on the
  // wire (instead of silently rounding server-side). Combined with the
  // `Min(0.01)` floor and `Max(1_000_000)` ceiling, this defends
  // against:
  //   • NaN / Infinity (class-validator rejects both via @IsNumber)
  //   • negative payments (those go through /payments/:id/refund)
  //   • copy-paste typos that introduce trailing decimals
  // Frontend mirrors this with `Math.round(amount * 100) / 100` before
  // submit, so a user pasting "100.005" gets cleaned up either way.
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
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

  /**
   * Caller-supplied idempotency key (UUID). Two payment creations with
   * the same key (within this school) resolve to the SAME payment row —
   * defends against double-clicks, slow-network retries, and offline
   * queue replays. The frontend should generate this once per "Save &
   * Print" intent and reuse it on retry.
   *
   * Optional: legacy callers without a key still work, they just don't
   * get idempotency.
   */
  @IsOptional()
  @IsUUID()
  clientRequestId?: string;
}
