import { Global, Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { HealthService } from './health.service';

// ---------------------------------------------------------------------------
// HealthModule — Phase 10.
//
// @Global() so callers (the global exception filter, AuthService,
// PlatformController) can inject `HealthService` without explicit
// imports — same pattern as FeatureFlagsModule. The exception filter
// in particular sits outside any feature module, so a non-global
// registration would force a one-off import path.
//
// Depends only on DatabaseModule. The service holds in-memory ring
// buffers + does a SELECT 1 probe; nothing else needed.
// ---------------------------------------------------------------------------

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [HealthService],
  exports: [HealthService],
})
export class HealthModule {}
