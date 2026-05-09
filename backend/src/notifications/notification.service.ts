import { Injectable, Logger } from '@nestjs/common';
import {
  Notification,
  NotificationChannel as ChannelEnum,
  NotificationDelivery,
  NotificationSeverity,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { EmailChannel } from './channels/email.channel';
import { InAppChannel } from './channels/in-app.channel';
import {
  NotificationChannelHandler,
  NotificationDispatchInput,
} from './channels/notification-channel';
import {
  getTemplate,
  type RenderedEmail,
} from './templates/template-registry';

// ---------------------------------------------------------------------------
// NotificationService — single ingestion point for every notification.
//
// API:
//   notifications.enqueue({ templateKey, recipient, payload, ... })
//
// What happens internally:
//   1. Look up the template in the registry. Unknown key → throw
//      (programmer error, not a delivery failure).
//   2. Resolve the dedupe key. If a Notification with the same
//      (templateKey, dedupeKey) already exists, return it without
//      writing a new one. Idempotency for at-least-once producers.
//   3. Persist Notification + one Delivery per channel in a single
//      transaction. Each delivery starts QUEUED.
//   4. Synchronously dispatch each delivery through its channel
//      handler. Update the row with the result.
//
// Why synchronous dispatch (no queue worker yet):
//   V1's volume is low (operator-triggered + a handful of system
//   events). A real queue (BullMQ / Redis) is the right shape once
//   we're sending more than a few thousand emails a day. The
//   `enqueue` name is forward-compatible: when the worker lands,
//   this method returns immediately and a separate process drains
//   the QUEUED rows. Callers don't need to change.
//
// Retry policy:
//   None at the service level today. A FAILED delivery stays FAILED;
//   the platform UI surfaces failures and an operator can re-trigger.
//   Phase-future: exponential backoff with a max-attempts ceiling
//   (3-5) implemented in the worker.
// ---------------------------------------------------------------------------

export interface EnqueueInput {
  templateKey: string;
  /**
   * Channel-keyed recipient map. Each key picks a channel:
   *   { email: 'foo@bar', inApp: '<userId>' }
   * Channels not present in the map are skipped — even if the
   * template's `defaultChannels` lists them. Pass null to force-skip
   * a channel entirely (rare; mostly for tests).
   */
  recipients: {
    email?: string;
    inApp?: string; // user id
    sms?: string;
    whatsapp?: string;
  };
  /** Template-specific payload — the renderer's input. */
  payload: Record<string, unknown>;
  /**
   * Optional idempotency key. Combined with templateKey, ensures
   * duplicate `enqueue()` calls collapse to a single Notification.
   */
  dedupeKey?: string;
  /**
   * Optional school/user scoping (for the listing UI / per-tenant
   * filtering later). Doesn't affect dispatch.
   */
  schoolId?: string;
  userId?: string;
  /**
   * Restrict to a subset of channels. When omitted, uses
   * `template.defaultChannels`. Useful for "send by email only,
   * even if the template supports in-app too" cases.
   */
  channels?: ChannelEnum[];
  /**
   * Phase 14 — operator-facing severity. Defaults to INFO.
   * Producers SHOULD pass an explicit severity for anything beyond
   * routine info events so the Notification Center's filter +
   * bell-badge are meaningful.
   */
  severity?: NotificationSeverity;
  /**
   * Phase 14 — denormalised display title for the Notification
   * Center list view. When omitted, defaults to the template's
   * key — readable enough that the list stays scannable while
   * producers gradually adopt the field.
   */
  title?: string;
}

export interface EnqueueResult {
  notification: Notification;
  deliveries: NotificationDelivery[];
  /** True iff a duplicate (templateKey + dedupeKey) was found and reused. */
  deduped: boolean;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);
  private readonly handlers: Map<ChannelEnum, NotificationChannelHandler>;

  constructor(
    private readonly prisma: PrismaService,
    email: EmailChannel,
    inApp: InAppChannel,
  ) {
    this.handlers = new Map();
    this.handlers.set(email.channel, email);
    this.handlers.set(inApp.channel, inApp);
  }

  /**
   * Create + dispatch a notification. Errors during dispatch do NOT
   * propagate — they're recorded on the delivery row. The only
   * thrown error is "template not found" (programmer error).
   */
  async enqueue(input: EnqueueInput): Promise<EnqueueResult> {
    const template = getTemplate(input.templateKey);
    if (!template) {
      throw new Error(
        `Unknown notification template: "${input.templateKey}". Add it to TEMPLATES in template-registry.ts.`,
      );
    }

    // Idempotency. We use Prisma's findFirst rather than relying
    // on the unique constraint to throw — gives us a cleaner code
    // path to return the existing rows.
    if (input.dedupeKey) {
      const existing = await this.prisma.notification.findUnique({
        where: {
          templateKey_dedupeKey: {
            templateKey: input.templateKey,
            dedupeKey: input.dedupeKey,
          },
        },
        include: { deliveries: true },
      });
      if (existing) {
        this.logger.debug(
          `Notification deduped — templateKey=${input.templateKey} dedupeKey=${input.dedupeKey}`,
        );
        return {
          notification: existing,
          deliveries: existing.deliveries,
          deduped: true,
        };
      }
    }

    // Decide which channels to fan out to.
    const channels: ChannelEnum[] =
      input.channels ?? [...template.defaultChannels];

    // Build the per-channel recipient list. Drop channels with no
    // recipient address — they were intentionally skipped.
    const dispatch: Array<{ channel: ChannelEnum; recipient: string }> = [];
    if (channels.includes('EMAIL') && input.recipients.email) {
      dispatch.push({ channel: 'EMAIL', recipient: input.recipients.email });
    }
    if (channels.includes('IN_APP') && input.recipients.inApp) {
      dispatch.push({ channel: 'IN_APP', recipient: input.recipients.inApp });
    }
    if (channels.includes('SMS') && input.recipients.sms) {
      dispatch.push({ channel: 'SMS', recipient: input.recipients.sms });
    }
    if (channels.includes('WHATSAPP') && input.recipients.whatsapp) {
      dispatch.push({
        channel: 'WHATSAPP',
        recipient: input.recipients.whatsapp,
      });
    }

    // Persist Notification + Delivery rows in one transaction.
    const created = await this.prisma.$transaction(async (tx) => {
      const notif = await tx.notification.create({
        data: {
          templateKey: input.templateKey,
          schoolId: input.schoolId ?? null,
          userId: input.userId ?? null,
          payload: input.payload as Prisma.InputJsonValue,
          dedupeKey: input.dedupeKey ?? null,
          severity: input.severity ?? 'INFO',
          title: input.title ?? input.templateKey,
        },
      });
      const deliveries = await Promise.all(
        dispatch.map((d) =>
          tx.notificationDelivery.create({
            data: {
              notificationId: notif.id,
              channel: d.channel,
              recipient: d.recipient,
              status: 'QUEUED',
            },
          }),
        ),
      );
      return { notif, deliveries };
    });

    // Render once per channel — templates may produce different
    // shapes (email subject vs in-app title).
    const renderedEmail: RenderedEmail | null = template.renderEmail
      ? template.renderEmail(input.payload as never) ?? null
      : null;
    const renderedInApp = template.renderInApp
      ? template.renderInApp(input.payload as never)
      : null;

    // Dispatch synchronously. Each delivery's outcome is written
    // back to its row.
    const finalDeliveries: NotificationDelivery[] = [];
    for (const delivery of created.deliveries) {
      const handler = this.handlers.get(delivery.channel);
      if (!handler) {
        // No handler registered (e.g. SMS/WhatsApp before they ship).
        const updated = await this.prisma.notificationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'SKIPPED',
            errorMessage: `No handler registered for channel ${delivery.channel}.`,
            attempts: 1,
          },
        });
        finalDeliveries.push(updated);
        continue;
      }
      const dispatchInput: NotificationDispatchInput = {
        recipient: delivery.recipient,
        rendered:
          delivery.channel === 'EMAIL'
            ? {
                subject: renderedEmail?.subject,
                html: renderedEmail?.html,
                text: renderedEmail?.text,
              }
            : delivery.channel === 'IN_APP'
              ? {
                  title: renderedInApp?.title,
                  body: renderedInApp?.body,
                }
              : {},
        payload: input.payload,
        notificationId: created.notif.id,
      };

      // Mark SENDING before the call so a crash mid-send leaves an
      // observable state ("we tried but never got a result").
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: { status: 'SENDING', attempts: { increment: 1 } },
      });

      const result = await handler.send(dispatchInput);
      const updated = await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: result.status,
          providerMessageId: result.providerMessageId ?? null,
          errorMessage: result.errorMessage ?? null,
          sentAt:
            result.status === 'SENT' || result.status === 'SKIPPED'
              ? new Date()
              : null,
        },
      });
      finalDeliveries.push(updated);
    }

    return {
      notification: created.notif,
      deliveries: finalDeliveries,
      deduped: false,
    };
  }
}
