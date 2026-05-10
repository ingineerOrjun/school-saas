import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';

// ---------------------------------------------------------------------------
// MaintenanceWindowService — Phase 22 (Section 10).
//
// Auto-applies scheduled maintenance windows. Runs every minute:
//
//   1. For every school with `maintenanceScheduledStart <= now` and
//      `maintenanceMode = false`, flip `maintenanceMode = true`.
//
//   2. For every school with `maintenanceScheduledEnd <= now` and
//      `maintenanceMode = true`, flip `maintenanceMode = false`
//      and clear the schedule fields.
//
// Why a sweeper (not a per-row timer):
//   • Process restarts don't lose timers — the next sweep tick picks
//     up wherever the schedule says we should be.
//   • One indexed scan per minute is trivial vs the maintenance
//     window cost itself.
//
// Operator API (broadcastSchedule / cancelSchedule) is exposed via
// PlatformController.setMaintenanceMode (existing endpoint accepts
// the new schedule fields). The sweeper is the enforcer; ops just
// stamps the timestamps.
// ---------------------------------------------------------------------------

@Injectable()
export class MaintenanceWindowService {
  private readonly logger = new Logger(MaintenanceWindowService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sweeper tick. Public so tests can drive deterministically.
   * Returns the count of schools whose `maintenanceMode` flipped.
   */
  async tick(now: Date = new Date()): Promise<{ enabled: number; disabled: number }> {
    const [enabled, disabled] = await Promise.all([
      this.prisma.school.updateMany({
        where: {
          maintenanceMode: false,
          maintenanceScheduledStart: { lte: now },
          OR: [
            { maintenanceScheduledEnd: null },
            { maintenanceScheduledEnd: { gt: now } },
          ],
        },
        data: { maintenanceMode: true },
      }),
      this.prisma.school.updateMany({
        where: {
          maintenanceMode: true,
          maintenanceScheduledEnd: { lte: now },
        },
        data: {
          maintenanceMode: false,
          maintenanceScheduledStart: null,
          maintenanceScheduledEnd: null,
          maintenanceMessage: null,
        },
      }),
    ]);
    if (enabled.count > 0) {
      this.logger.warn(
        `[maintenance-window] auto-enabled maintenance for ${enabled.count} school(s)`,
      );
    }
    if (disabled.count > 0) {
      this.logger.log(
        `[maintenance-window] auto-disabled (window expired) for ${disabled.count} school(s)`,
      );
    }
    return { enabled: enabled.count, disabled: disabled.count };
  }

  /**
   * Cron entry. Fires every minute.
   *
   * `EVERY_MINUTE` is hard-coded; the sweep is cheap and the
   * scheduling resolution is "minutes" (operators don't think in
   * sub-minute increments). A future enhancement could surface this
   * via env, but YAGNI for v1.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'maintenance-window-sweep' })
  async scheduledTick(): Promise<void> {
    try {
      await this.tick();
    } catch (e) {
      this.logger.error(
        `Maintenance-window sweep failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
