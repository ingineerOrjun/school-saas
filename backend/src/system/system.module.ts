import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { OperationsModule } from '../operations/operations.module';
import { BackupStatusService } from './backup-status.service';
import { IntegrityCheckService } from './integrity-check.service';
import { SystemController } from './system.controller';

// ============================================================================
// SystemModule — Phase PLATFORM STABILIZATION Parts 4 + 6 + 7.
//
// School-admin facing operational health surface. NOT to be confused
// with:
//   • OperationsModule — SUPER_ADMIN-only platform cockpit.
//   • HealthModule     — unauthenticated liveness/readiness probes.
//
// This module re-uses the existing BackupService (exported by
// OperationsModule) but exposes only a deliberately small read-only
// shape to school admins. The integrity check is brand-new and lives
// here from day one.
// ============================================================================

@Module({
  imports: [DatabaseModule, OperationsModule],
  controllers: [SystemController],
  providers: [BackupStatusService, IntegrityCheckService],
  exports: [BackupStatusService, IntegrityCheckService],
})
export class SystemModule {}
