import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Refund a previously-recorded payment. The result is a NEW payment row
 * with a negative `amount`, linked back to the original via
 * `refundOfPaymentId`. We never delete or mutate the source row — that
 * would invalidate any receipts already issued and break the audit trail.
 *
 * Why pass `amount` instead of always refunding the full original?
 *   • Real schools do partial refunds: parent overpaid by 500, refund
 *     500 not the whole 5,000.
 *   • The service caps it server-side so callers can't accidentally
 *     refund more than was paid.
 *
 * `reason` is required (free-form, max 500 chars). Refunds without a
 * reason are an audit smell — if there's no story behind it, don't do it.
 */
export class RefundPaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsString()
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
