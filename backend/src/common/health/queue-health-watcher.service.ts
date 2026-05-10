import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { JobQueueService } from '../jobs/job-queue.service';
import { NotificationService } from '../../notifications/notification.service';
import { PrismaService } from '../../database/prisma.service';

// ---------------------------------------------------------------------------
// QueueHealthWatcher — Phase α.
//
// Background watchdog. Wakes every 5 minutes, checks for queue
// pathologies, and emits a CRITICAL platform notification to every
// SUPER_ADMIN when any threshold trips. The existing alerting
// infrastructure (NotificationService + bell badge + email channel)
// surfaces it.
//
// Watches three signals:
//
//   1. Stalled drain — pending depth grew without going down for
//      ≥30 minutes. Means the runner is consuming jobs slower than
//      they're enqueued, OR a flood of bad jobs is parking in the
//      queue.
//
//   2. Stuck workers — RUNNING rows held >15 minutes (the existing
//      `JobQueueService.sweepStuck` covers >10 min recovery; this
//      watcher alerts on the >15min threshold so an operator
//      investigates in case the sweeper itself is broken).
//
//   3. Dead-letter accumulation — FAILED_PERMANENT count grew by
//      >5 in the last hour. One bad handler can flood the dead
//      letter queue silently otherwise.
//
// De-dup:
//   We keep a per-key `lastFiredAt` map in memory so the same alert
//   doesn't fan out every 5 minutes. Same alert quiet-period:
//   ALERT_COOLDOWN_MS (default 1 hour). Process restart wipes the
//   cooldown state — that's correct ("did this alert already
//   fire since deploy?" should reset on deploy).
//
// Why not a separate alert table:
//   The platform_audit_events table + the notification trail
//   already record every alert (audit row + Notification row).
//   In-memory dedup is just to avoid spam between restart cycles.
// ---------------------------------------------------------------------------

const ALERT_COOLDOWN_MS = 60 * 60_000;
const STALLED_THRESHOLD_MIN = 30;
const STUCK_THRESHOLD_MIN = 15;
const DEAD_LETTER_DELTA_THRESHOLD = 5;

@Injectable()
export class QueueHealthWatcher {
  private readonly logger = new Logger(QueueHealthWatcher.name);
  private readonly lastFiredAt = new Map<string, number>();
  // Track pending depth across ticks so we can detect "growing
  // without draining". Each entry is { ts, count }.
  private readonly depthHistory: Array<{ at: number; count: number }> = [];
  // Track dead-letter count for hourly delta detection.
  private lastDeadLetterCount: number | null = null;
  private lastDeadLetterCheckAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  /** Cron entry — every 5 minutes. */
  @Cron('*/5 * * * *', { name: 'queue-health-watch' })
  async tick(): Promise<{ alerts: string[] }> {
    const alerts: string[] = [];
    try {
      // 1. Pending depth + stalled-drain detection.
      const stats = await this.queue.stats();
      const pendingDepth = (stats.PENDING ?? 0) + (stats.SCHEDULED ?? 0);
      this.recordDepth(pendingDepth);
      if (this.isStalled()) {
        if (this.shouldFire('stalled-drain')) {
          await this.alert(
            'CRITICAL',
            'Queue drain stalled',
            `Pending job depth has been growing without draining for ${STALLED_THRESHOLD_MIN}+ minutes. Current depth: ${pendingDepth}. Investigate the runner — may be wedged on a slow handler or hitting a downstream timeout.`,
          );
          alerts.push('stalled-drain');
        }
      }

      // 2. Stuck workers — RUNNING > STUCK_THRESHOLD_MIN min.
      const stuckCutoff = new Date(Date.now() - STUCK_THRESHOLD_MIN * 60_000);
      const stuckCount = await this.prisma.job.count({
        where: { status: 'RUNNING', startedAt: { lt: stuckCutoff } },
      });
      if (stuckCount > 0 && this.shouldFire('stuck-workers')) {
        await this.alert(
          'CRITICAL',
          'Stuck job workers detected',
          `${stuckCount} job(s) have been RUNNING for over ${STUCK_THRESHOLD_MIN} minutes. The auto-sweeper recovers at 10 minutes; if these are still stuck, the sweeper itself may be wedged. Check /platform/operations/jobs.`,
        );
        alerts.push('stuck-workers');
      }

      // 3. Dead-letter delta — accumulated >N new in the last hour.
      const dlCount = stats.FAILED_PERMANENT ?? 0;
      if (this.lastDeadLetterCount !== null) {
        const delta = dlCount - this.lastDeadLetterCount;
        const sinceLastCheckMs = Date.now() - this.lastDeadLetterCheckAt;
        if (
          delta >= DEAD_LETTER_DELTA_THRESHOLD &&
          sinceLastCheckMs >= 55 * 60_000 && // ~hourly
          this.shouldFire('dead-letter-delta')
        ) {
          await this.alert(
            'WARNING',
            'Dead-letter queue growing',
            `${delta} new dead-letter rows in the last hour (total ${dlCount}). One handler may be permanently failing. Open /platform/operations and inspect the dead-letter panel.`,
          );
          alerts.push('dead-letter-delta');
        }
      }
      // Reset the rolling reference every hour.
      if (
        this.lastDeadLetterCount === null ||
        Date.now() - this.lastDeadLetterCheckAt > 60 * 60_000
      ) {
        this.lastDeadLetterCount = dlCount;
        this.lastDeadLetterCheckAt = Date.now();
      }
    } catch (e) {
      // Watchdog failure must NOT crash the cron loop; log + move on.
      this.logger.error(
        `Queue health watch failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    return { alerts };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private recordDepth(depth: number): void {
    this.depthHistory.push({ at: Date.now(), count: depth });
    // Keep last hour only.
    const cutoff = Date.now() - 60 * 60_000;
    while (this.depthHistory.length > 0 && this.depthHistory[0].at < cutoff) {
      this.depthHistory.shift();
    }
  }

  /**
   * "Stalled" means: depth is non-zero AND has not gone DOWN in the
   * last STALLED_THRESHOLD_MIN minutes. We allow short rises if a
   * later sample returns to baseline; we only alert if the queue
   * monotonically grew (or held) for the whole window.
   */
  private isStalled(): boolean {
    if (this.depthHistory.length < 2) return false;
    const cutoff = Date.now() - STALLED_THRESHOLD_MIN * 60_000;
    const window = this.depthHistory.filter((s) => s.at >= cutoff);
    if (window.length < 2) return false;
    const first = window[0].count;
    const min = Math.min(...window.map((s) => s.count));
    // Did the queue ever drop below the starting depth? If yes, we
    // saw progress — not stalled. If no, it held or grew the whole
    // window.
    return first > 0 && min >= first;
  }

  private shouldFire(key: string): boolean {
    const last = this.lastFiredAt.get(key) ?? 0;
    const cooldownMs = this.numEnv('ALERT_COOLDOWN_MS', ALERT_COOLDOWN_MS);
    if (Date.now() - last < cooldownMs) return false;
    this.lastFiredAt.set(key, Date.now());
    return true;
  }

  private async alert(
    severity: 'INFO' | 'WARNING' | 'CRITICAL',
    title: string,
    body: string,
  ): Promise<void> {
    this.logger.error(`[health-watch] ${severity} ${title}: ${body}`);
    // Find every SUPER_ADMIN and fan out an in-app notification.
    // Keep the targeting bounded — we don't email here (that's
    // the operator's reactive call), just surface the alert in the
    // bell badge + Operations Center event stream.
    const supers = await this.prisma.user.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: { id: true, email: true },
      take: 50,
    });
    for (const u of supers) {
      try {
        await this.notifications.enqueue({
          templateKey: 'platform.incident_broadcast',
          recipients: { inApp: u.id },
          payload: {
            brand: this.brand(),
            headline: title,
            body,
            severity,
            broadcastAt: new Date().toISOString(),
            broadcastBy: '<system: queue-health-watch>',
          },
          // Per-incident dedup so the same alert in the same hour
          // doesn't double-fire across the cron loop's restart edge.
          dedupeKey: `health:${title}:${Math.floor(Date.now() / (60 * 60_000))}`,
          userId: u.id,
          severity,
          title: `[${severity}] ${title}`,
          channels: ['IN_APP'],
        });
      } catch (e) {
        // Single-recipient failure — log but keep fanning out.
        this.logger.warn(
          `[health-watch] alert enqueue failed for user=${u.id}: ${(e as Error).message}`,
        );
      }
    }
  }

  private brand() {
    return (
      this.config.get<{
        productName?: string;
        supportEmail?: string;
      }>('mail.brand') ?? {
        productName: 'Scholaris',
        supportEmail: 'support@scholaris.local',
      }
    );
  }

  private numEnv(key: string, fallback: number): number {
    const raw = this.config.get<string>(key) ?? process.env[key];
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }
}
