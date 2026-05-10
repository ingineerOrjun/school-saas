import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BackupStubService } from '../common/backup/backup-stub.service';
import { BackupService } from '../common/backup/backup.service';
import { LocalDiskProvider } from '../common/backup/local-disk-provider';
import { QueueHealthWatcher } from '../common/health/queue-health-watcher.service';
import { CleanupService } from '../common/maintenance/cleanup.service';
import { MaintenanceWindowService } from '../common/maintenance/maintenance-window.service';
import { DatabaseModule } from '../database/database.module';
import { PlatformModule } from '../platform/platform.module';
import { IncidentService } from './incident.service';
import { MobileMetricsService } from './mobile-metrics.service';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

// ---------------------------------------------------------------------------
// OperationsModule — Phase 21 cockpit module.
//
// Composition:
//   • OperationsService — fan-out aggregator across the existing
//     operational services (Health / Jobs / Metrics / Sessions /
//     Audit / Notifications).
//   • IncidentService   — operator-broadcast incidents via the
//     existing NotificationService.
//   • OperationsController — SUPER_ADMIN-only endpoints under
//     /platform/operations/*.
//
// Why a dedicated module:
//   • Keeps the platform module focused on tenant management;
//     operations is a pure read-side aggregation surface (with
//     a few operator action endpoints).
//   • Easier future split — if we ever extract the operations
//     surface into a separate process (telemetry sidecar), it's
//     already isolated.
//
// Dependencies:
//   • PlatformModule — re-uses PlatformAuditService, SecurityService
//     (PlatformModule is NOT @Global, so this import is required).
//   • SessionsModule — @Global from sessions/sessions.module, so
//     SessionService injects without explicit import.
//   • JobQueueService — @Global from JobsModule.
//   • RequestMetricsService — registered as a top-level provider in
//     AppModule (via the new observability middleware wiring), so
//     it's available everywhere without an import.
//   • HealthService — @Global from HealthModule.
//   • NotificationService — @Global from NotificationsModule.
//   • PrismaService — DatabaseModule.
//   • ConfigModule — IncidentService reads `mail.brand`.
// ---------------------------------------------------------------------------

@Module({
  imports: [DatabaseModule, ConfigModule, PlatformModule],
  controllers: [OperationsController],
  providers: [
    OperationsService,
    IncidentService,
    // Phase 22 — background sweepers + placeholders.
    // ScheduleModule.forRoot() is registered by PlatformModule (which
    // OperationsModule imports), so @Cron decorators on these
    // providers are picked up by the schedule explorer.
    MaintenanceWindowService,
    CleanupService,
    BackupStubService,
    // Phase 26 — mobile metrics rollup. Read-only aggregator over
    // Session + Job tables; no new schema, no client-telemetry POST.
    MobileMetricsService,
    // Phase α — real backup engine. Replaces the BackupStubService
    // for production use; the stub stays exported for any ops UI
    // that hasn't migrated yet (ProductizationModule still uses
    // it for the cards).
    LocalDiskProvider,
    BackupService,
    // Phase α — periodic queue health watchdog. Cron-driven; emits
    // CRITICAL platform notifications when the queue stalls.
    QueueHealthWatcher,
  ],
  exports: [
    OperationsService,
    IncidentService,
    MaintenanceWindowService,
    CleanupService,
    BackupStubService,
    MobileMetricsService,
    BackupService,
  ],
})
export class OperationsModule {}
