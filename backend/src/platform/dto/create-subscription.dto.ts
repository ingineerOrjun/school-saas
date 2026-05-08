import { BillingCycle, SubscriptionPlan } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Body for POST /platform/schools/:id/subscriptions.
 *
 * Plan + cycle are enums. Dates come in as ISO strings — Nest +
 * class-validator handle the parse, the service converts to Date
 * before persisting.
 *
 * studentLimit / teacherLimit are optional (null = unlimited) but
 * must be non-negative integers when provided.
 */
export class CreateSubscriptionDto {
  @IsEnum(SubscriptionPlan)
  plan!: SubscriptionPlan;

  @IsEnum(BillingCycle)
  billingCycle!: BillingCycle;

  @IsDateString()
  startDate!: string;

  /**
   * Required for non-UNLIMITED plans; the service rejects with 400
   * when missing on those plans. UNLIMITED ignores any passed
   * value (set to null on insert).
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsDateString()
  endDate?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  studentLimit?: number | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  teacherLimit?: number | null;

  @IsOptional()
  @IsObject()
  enabledFeatures?: Record<string, boolean>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string | null;
}
