import {
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Body for PATCH /platform/schools/:id/features.
 *
 * `overrides` is a flat `{ key: boolean }` object. The service
 * validates each key against the catalog (`VALID_FEATURE_KEYS`) and
 * rejects unknown entries — `class-validator` can't do that without
 * a custom validator, and putting the catalog check at the service
 * layer keeps the validation centralised next to the read paths.
 *
 * `reason` is captured for the FEATURE_FLAG_CHANGED audit row. The
 * platform UI surfaces this as a free-form note ("upgraded customer
 * to SMS for trial extension") so the audit log is readable without
 * cross-referencing tickets.
 */
export class UpdateFeatureOverridesDto {
  @IsObject()
  overrides!: Record<string, boolean>;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
