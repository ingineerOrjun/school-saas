import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsGuard } from './feature-flags.guard';
import { FeatureFlagsService } from './feature-flags.service';

// ---------------------------------------------------------------------------
// FeatureFlagsModule — Phase 5.
//
// @Global() so any controller can apply `@UseGuards(FeatureFlagsGuard)`
// + `@RequireFeature(...)` without explicitly importing this module.
// Keeps the per-module wiring noise low: every feature module would
// otherwise need to add this import alongside the existing AuthModule
// + RolesGuard incantation.
//
// Deliberately depends only on DatabaseModule. The override-write
// path emits a FEATURE_FLAG_CHANGED audit row from PlatformController
// (not from this service), which avoids a circular module dep:
//   FeatureFlagsModule  →  PlatformModule  →  PlatformController
//                                              ↑
//                                              uses FeatureFlagsService
// ---------------------------------------------------------------------------

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [FeatureFlagsController],
  providers: [FeatureFlagsService, FeatureFlagsGuard],
  exports: [FeatureFlagsService, FeatureFlagsGuard],
})
export class FeatureFlagsModule {}
