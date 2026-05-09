import { Injectable, Logger } from '@nestjs/common';
import type { NotificationChannel as Channel } from '@prisma/client';
import {
  NotificationChannelHandler,
  NotificationDispatchInput,
  NotificationDispatchResult,
} from './notification-channel';

// ---------------------------------------------------------------------------
// InAppChannel — placeholder for the future in-app notification feed.
//
// V1 doesn't have an in-app inbox UI, so this handler just records
// that the delivery was "SENT" — the Notification + Delivery rows in
// the DB ARE the inbox until a UI lights up to render them. When the
// inbox UI ships, this handler stays the same; the consumer (a
// NotificationsBell on the topbar) reads notifications + deliveries
// directly from Prisma.
// ---------------------------------------------------------------------------

@Injectable()
export class InAppChannel implements NotificationChannelHandler {
  channel: Channel = 'IN_APP';
  private readonly logger = new Logger('Notification/InAppChannel');

  async send(
    input: NotificationDispatchInput,
  ): Promise<NotificationDispatchResult> {
    if (!input.rendered.title) {
      return { status: 'SKIPPED', errorMessage: 'No in-app body rendered.' };
    }
    // Intentionally a no-op beyond logging — the Notification + Delivery
    // rows already exist in the DB by the time this method returns;
    // the inbox UI will read them when it ships.
    this.logger.debug(
      `In-app notification queued → user=${input.recipient} title="${input.rendered.title}"`,
    );
    return Promise.resolve({ status: 'SENT' });
  }
}
