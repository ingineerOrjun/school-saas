import { SetMetadata } from '@nestjs/common';
import type { FeatureKeyValue } from './feature-catalog';

/**
 * Metadata key the FeatureFlagsGuard reads to discover which feature
 * a handler (or controller class) requires. Constant kept beside the
 * decorator + guard so all three stay in sync.
 */
export const REQUIRE_FEATURE_KEY = 'requireFeature';

/**
 * Mark a handler (or controller) as gated behind one feature flag.
 * The guard reads `req.user.schoolId`, resolves the effective
 * features for that school, and rejects with 403 when the flag is
 * off.
 *
 * Usage (controller-level — gates every route):
 *
 *   @Controller('announcements')
 *   @UseGuards(JwtAuthGuard, RolesGuard, FeatureFlagsGuard)
 *   @RequireFeature(FeatureKey.Announcements)
 *   export class AnnouncementController { ... }
 *
 * Method-level decoration overrides the class-level value, so a
 * "always-on" exception handler can be carved out by setting it to
 * `null` (the guard treats null as "no feature gate").
 *
 * SUPER_ADMIN bypasses every flag — platform owners need to be able
 * to inspect data on schools that have a feature disabled.
 */
export const RequireFeature = (feature: FeatureKeyValue) =>
  SetMetadata(REQUIRE_FEATURE_KEY, feature);
