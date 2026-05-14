import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { PortfolioItemController } from './portfolio-item.controller';
import { PortfolioItemService } from './portfolio-item.service';

// ============================================================================
// PortfolioItemModule — CDC portfolio-item write surface.
//
// Mirrors ContinuousRecordModule one-for-one:
//   • Imports DatabaseModule for PrismaService.
//   • Does NOT import AcademicSessionModule or TeacherScopeModule —
//     both are @Global, so their exported services are visible
//     everywhere.
//   • Does NOT import FeatureFlagsModule — the guard reaches its
//     dependencies through the global module graph, same pattern as
//     ContinuousRecord / LearningOutcome / Promotion / Announcement.
//   • Exports nothing. Future modules that need to look up a student's
//     portfolio items should consume the read endpoint, not reach
//     into this service.
// ============================================================================

@Module({
  imports: [DatabaseModule],
  controllers: [PortfolioItemController],
  providers: [PortfolioItemService],
})
export class PortfolioItemModule {}
