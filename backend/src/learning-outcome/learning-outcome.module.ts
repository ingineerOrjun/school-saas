import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { LearningOutcomeController } from './learning-outcome.controller';
import { LearningOutcomeService } from './learning-outcome.service';

// ============================================================================
// LearningOutcomeModule — CDC continuous-evaluation foundation.
//
// Read-only by design. Wires the controller + service that expose the
// seeded LearningOutcome catalogue (`prisma/seed-cdc-outcomes.ts`).
// Feature-gated at the controller level via `@RequireFeature(
// FeatureKey.ConEvaluation)`.
//
// Imports:
//   • DatabaseModule — supplies PrismaService for the read query.
//   • FeatureFlagsModule is NOT imported here. The guard
//     (FeatureFlagsGuard) is referenced as a class in @UseGuards and
//     gets its dependencies from the global module graph; the
//     pattern matches PromotionModule + AnnouncementModule which
//     also omit an explicit FeatureFlagsModule import.
//
// Exports: none for now. If a future write module needs to look up
// outcomes (e.g. attaching teacher ratings), export the service then.
// ============================================================================

@Module({
  imports: [DatabaseModule],
  controllers: [LearningOutcomeController],
  providers: [LearningOutcomeService],
})
export class LearningOutcomeModule {}
