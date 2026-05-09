import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Role } from '@prisma/client';
import { JobQueueService } from '../common/jobs/job-queue.service';
import { PrismaService } from '../database/prisma.service';

// ---------------------------------------------------------------------------
// SubscriptionExpiringJob — Phase 3 (maturity).
//
// Daily scan that fires the `platform.subscription_expiring` email
// to every school whose current subscription falls inside the warning
// window. Sends ONE notice per (school, threshold) — dedupe is keyed
// on the threshold so a school crossing 14d → 7d → 1d → 0d → expired
// receives at most one email per checkpoint.
//
// Thresholds (days remaining):
//   14   → "expires in 2 weeks"
//    7   → "expires in a week"
//    1   → "expires tomorrow"
//    0   → "expires today"
//   -1   → "expired" (one final notice)
//
// Why static thresholds (and not a daily reminder):
//   • A daily nag would make the inbox unusable. Schools renew on
//     batch cycles (monthly / quarterly), not daily reminders.
//   • Each threshold targets a different decision point — 14d gives
//     time to budget, 7d means "this week," 1d/0d are urgent.
//   • The expired threshold (-1) catches the case where the
//     operator missed every prior notice; sent once.
//
// Recipient resolution:
//   First ADMIN at the school by createdAt — that's the
//   account-creation admin, who's the most-likely renewal contact.
//   Multi-admin notification fan-out (email every admin) is a
//   future refinement; today the call goes to the primary.
//
// Schedule:
//   Daily at 09:00 in the deployment's local timezone (default
//   server time). Pre-business-hours so renewal calls land before
//   the school day starts. Configurable via SCHEDULE_TZ env in a
//   future iteration if customers split across regions.
// ---------------------------------------------------------------------------

const THRESHOLDS_DAYS = [14, 7, 1, 0, -1] as const;
type Threshold = (typeof THRESHOLDS_DAYS)[number];

@Injectable()
export class SubscriptionExpiringJob {
  private readonly logger = new Logger(SubscriptionExpiringJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: JobQueueService,
  ) {}

  /**
   * Cron entry — runs once a day. The actual work lives in `runOnce`
   * so a future operator-tier "send now" affordance can call the
   * same method synchronously without going through the scheduler.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM, {
    name: 'subscription-expiring-notice',
    // Time zone defaults to the host's. Set TZ=Asia/Kathmandu (or
    // similar) in the deployment env to lock the schedule to the
    // operator's region.
  })
  async run() {
    try {
      const result = await this.runOnce(new Date());
      this.logger.log(
        `[cron] subscription-expiring scan complete: scanned=${result.scanned} ` +
          `enqueued=${result.enqueued} deduped=${result.deduped}`,
      );
    } catch (e) {
      // Cron errors should never crash the worker — Nest swallows
      // throws but log loudly so the next run's metrics surface
      // the gap.
      this.logger.error(
        `[cron] subscription-expiring failed: ${e instanceof Error ? e.message : String(e)}`,
        e instanceof Error ? e.stack : undefined,
      );
    }
  }

  /**
   * Public for tests + a future "force run" endpoint. `now` injected
   * so unit tests can step the clock without monkey-patching Date.
   *
   * Phase 15 — the cron now ENQUEUES one job per due school instead
   * of dispatching emails inline. The job queue handles per-recipient
   * retry + backoff; the cron stays fast and stateless.
   */
  async runOnce(
    now: Date,
  ): Promise<{ scanned: number; enqueued: number; deduped: number }> {
    // Pull every school with a subscription endDate within range.
    // Range covers all thresholds + a 1-day buffer so a freshly-
    // expired school still gets the -1 notice on the next run.
    const earliest = addDays(now, -2);
    const latest = addDays(now, 15);
    const schools = await this.prisma.school.findMany({
      where: {
        status: { in: ['ACTIVE', 'TRIAL'] },
        expiresAt: { gte: earliest, lte: latest },
      },
      select: {
        id: true,
        expiresAt: true,
        users: {
          where: { role: Role.ADMIN },
          take: 1,
          select: { id: true },
        },
      },
    });

    let enqueued = 0;
    let deduped = 0;
    for (const school of schools) {
      const endDate = school.expiresAt;
      if (!endDate) continue;
      if (school.users.length === 0) continue; // no admin → no notice

      const daysRemaining = daysBetween(now, endDate);
      const threshold = matchThreshold(daysRemaining);
      if (threshold === null) continue;

      const result = await this.queue.enqueue({
        name: 'platform.subscription_expiring_notice',
        // Per-day dedupe so a same-day retry of the cron is a no-op
        // but tomorrow's run for the same threshold (e.g. 7d on a
        // newly-eligible school) still enqueues fresh.
        dedupeKey: `school:${school.id}:expiring:${threshold}:${dayKey(now)}`,
        payload: { schoolId: school.id, threshold },
      });

      if (result.deduped) deduped += 1;
      else enqueued += 1;
    }

    return { scanned: schools.length, enqueued, deduped };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

/**
 * Whole days between `now` and `target`. Truncates: 23h59m → 0,
 * 24h01m → 1. Negative when target is in the past.
 */
function daysBetween(now: Date, target: Date): number {
  const ms = target.getTime() - now.getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Snap a daysRemaining count to the nearest threshold the cron
 * should send for. Returns null when the count doesn't match any
 * threshold (so we don't spam on intermediate days).
 */
function matchThreshold(daysRemaining: number): Threshold | null {
  for (const t of THRESHOLDS_DAYS) {
    if (daysRemaining === t) return t;
  }
  return null;
}

/** YYYYMMDD key in UTC — used to dedupe per-day cron runs. */
function dayKey(d: Date): string {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}
