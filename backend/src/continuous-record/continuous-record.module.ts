import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ContinuousRecordController } from './continuous-record.controller';
import { ContinuousRecordService } from './continuous-record.service';

// ============================================================================
// ContinuousRecordModule — CDC continuous-evaluation write surface.
//
// Wires the controller + service that own POST/POST-bulk/GET on
// /continuous-records. The feature-flag guard (FeatureFlagsGuard +
// @RequireFeature(ConEvaluation)) is referenced as a class at the
// controller level and gets its dependencies from the global module
// graph — same pattern used by LearningOutcomeModule + PromotionModule
// + AnnouncementModule.
//
// Imports:
//   • DatabaseModule — supplies PrismaService.
//   • AcademicSessionModule is NOT imported here: it's @Global, so its
//     exported AcademicSessionService is visible everywhere.
//   • TeacherScopeModule is NOT imported here for the same reason.
//
// Exports: none. Future modules that need to look up a student's
// continuous-evaluation history should consume the read API, not
// reach into this service.
// ============================================================================

@Module({
  imports: [DatabaseModule],
  controllers: [ContinuousRecordController],
  providers: [ContinuousRecordService],
})
export class ContinuousRecordModule {}
