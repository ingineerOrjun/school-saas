import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  JobHandler,
  JobNonRetryableError,
  type JobContext,
} from '../../common/jobs/job-handler.interface';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from '../../notifications/notification.service';

// ---------------------------------------------------------------------------
// SubscriptionExpiringNoticeHandler — Phase 15.
//
// Job that fires the `platform.subscription_expiring` notification
// for ONE school × ONE threshold. Scheduled by SubscriptionExpiringJob's
// daily scan so the cron stays fast (just enqueues N jobs) and the
// retry budget for individual emails is per-recipient, not per-cron-run.
//
// Payload shape:
//   { schoolId: string, threshold: number }
//
// Idempotency:
//   Composes a dedupe key as `school:<id>:expiring:<threshold>:<yyyymmdd>`.
//   Re-running the same scan the same day re-uses the existing job.
//   The notification.enqueue call below also dedupes on its own
//   (templateKey, dedupeKey) — belt-and-suspenders against duplicate
//   emails.
// ---------------------------------------------------------------------------

export interface SubscriptionExpiringNoticePayload {
  schoolId: string;
  threshold: number;
}

@Injectable()
export class SubscriptionExpiringNoticeHandler
  implements JobHandler<SubscriptionExpiringNoticePayload>
{
  name = 'platform.subscription_expiring_notice';
  maxAttempts = 3;

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly config: ConfigService,
  ) {}

  async run(
    payload: SubscriptionExpiringNoticePayload,
    _ctx: JobContext,
  ): Promise<void> {
    const school = await this.prisma.school.findUnique({
      where: { id: payload.schoolId },
      select: {
        id: true,
        name: true,
        expiresAt: true,
        users: {
          where: { role: 'ADMIN' },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { id: true, email: true },
        },
        subscriptions: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { plan: true },
        },
      },
    });
    if (!school || !school.expiresAt) {
      // School may have been deleted or had its plan changed
      // between scan and dispatch — neither is retryable.
      throw new JobNonRetryableError(
        `School ${payload.schoolId} no longer eligible for expiry notice.`,
      );
    }
    const admin = school.users[0];
    if (!admin) {
      throw new JobNonRetryableError(
        `School ${payload.schoolId} has no ADMIN to notify.`,
      );
    }

    const now = new Date();
    const daysRemaining = Math.floor(
      (school.expiresAt.getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );

    await this.notifications.enqueue({
      templateKey: 'platform.subscription_expiring',
      recipients: { email: admin.email, inApp: admin.id },
      dedupeKey: `school:${school.id}:expiring:${payload.threshold}`,
      schoolId: school.id,
      userId: admin.id,
      payload: {
        brand: this.config.get('mail.brand'),
        schoolName: school.name,
        adminEmail: admin.email,
        daysRemaining,
        endDate: school.expiresAt.toISOString(),
        plan: school.subscriptions[0]?.plan ?? 'UNKNOWN',
        billingUrl: `${this.config.get('appUrl')}/settings/billing`,
      },
    });
  }
}
