import { Module, forwardRef } from '@nestjs/common';
import { PlatformModule } from '../platform/platform.module';
import { PromotionController } from './promotion.controller';
import { PromotionService } from './promotion.service';
import { PromotionPreviewService } from './promotion-preview.service';

/**
 * Phase ACADEMIC TRANSITION SAFETY:
 *   • PromotionPreviewService (Part 1) generates dry-run validation
 *     reports — audits via PlatformAuditService.
 *   • PromotionService (Part 6) writes PROMOTION_EXECUTED audit rows
 *     and stamps `promotedById` / `nextClassId` snapshots on each
 *     StudentAcademicRecord.
 *
 * Both depend on PlatformModule (PlatformAuditService); the
 * forwardRef matches the existing pattern used in ExamsModule /
 * StudentModule and keeps us safe against any future platform
 * back-import chain.
 */
@Module({
  imports: [forwardRef(() => PlatformModule)],
  controllers: [PromotionController],
  providers: [PromotionService, PromotionPreviewService],
  // Export the preview service so other modules (e.g. a future
  // automated rollover scheduler) can validate before scheduling.
  exports: [PromotionService, PromotionPreviewService],
})
export class PromotionModule {}
