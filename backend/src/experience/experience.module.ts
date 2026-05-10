import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExperienceController } from './experience.controller';
import { GlobalSearchService } from './global-search.service';

// ---------------------------------------------------------------------------
// ExperienceModule — Phase 24 (school experience polish).
//
// Lightweight module — one service + one controller for the unified
// /me/search endpoint. No new infra, no new schema, no new
// dependencies beyond DatabaseModule.
//
// Future polish endpoints (saved-filters, recent-actions, dashboard
// personalisation read-side) land here too as the phase grows. The
// module name "experience" is intentional — these are tenant-side
// UX features, not platform tooling.
// ---------------------------------------------------------------------------

@Module({
  imports: [DatabaseModule],
  controllers: [ExperienceController],
  providers: [GlobalSearchService],
  exports: [GlobalSearchService],
})
export class ExperienceModule {}
