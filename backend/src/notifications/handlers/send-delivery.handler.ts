import { Injectable, Logger } from '@nestjs/common';
import {
  JobHandler,
  JobNonRetryableError,
  type JobContext,
} from '../../common/jobs/job-handler.interface';
import { PrismaService } from '../../database/prisma.service';
import { EmailChannel } from '../channels/email.channel';
import { InAppChannel } from '../channels/in-app.channel';
import type { NotificationChannelHandler } from '../channels/notification-channel';
import { getTemplate } from '../templates/template-registry';

// ---------------------------------------------------------------------------
// SendDeliveryHandler — Phase 15.
//
// Job that dispatches ONE notification delivery row through its
// channel handler. Used by the future async notification path.
//
// Payload shape:
//   { deliveryId: string }
//
// Why a single-delivery job (not "send the whole notification"):
//   • Each delivery's success/failure is independent — a failed
//     email shouldn't retry a successful in-app push.
//   • Retries map naturally to per-delivery backoff.
//   • The delivery row already carries channel + recipient + status,
//     so the payload stays a single id.
//
// Idempotency:
//   The dedupe key for these jobs is `delivery:<id>`. A re-enqueue
//   for the same delivery short-circuits in JobQueueService.
//
// Error handling:
//   • Delivery row not found → JobNonRetryableError (somebody
//     deleted the row; retrying won't bring it back).
//   • Already SENT or SKIPPED → no-op (idempotent — handles the
//     case where the producer fired sync AND scheduled async).
//   • Handler resolves with FAILED → throw so the job retries with
//     backoff. Once the job's maxAttempts exhausts, the delivery row
//     stays FAILED and the job goes FAILED.
// ---------------------------------------------------------------------------

export interface SendDeliveryPayload {
  deliveryId: string;
}

@Injectable()
export class SendDeliveryHandler implements JobHandler<SendDeliveryPayload> {
  name = 'notification.send_delivery';
  maxAttempts = 5; // emails get a slightly more generous retry budget

  private readonly logger = new Logger(SendDeliveryHandler.name);
  private readonly handlers: Map<string, NotificationChannelHandler>;

  constructor(
    private readonly prisma: PrismaService,
    email: EmailChannel,
    inApp: InAppChannel,
  ) {
    this.handlers = new Map();
    this.handlers.set(email.channel, email);
    this.handlers.set(inApp.channel, inApp);
  }

  async run(payload: SendDeliveryPayload, ctx: JobContext): Promise<void> {
    const delivery = await this.prisma.notificationDelivery.findUnique({
      where: { id: payload.deliveryId },
      include: { notification: true },
    });
    if (!delivery) {
      throw new JobNonRetryableError(
        `Delivery ${payload.deliveryId} not found`,
      );
    }
    if (delivery.status === 'SENT' || delivery.status === 'SKIPPED') {
      ctx.logger.debug(
        `Delivery ${delivery.id} already ${delivery.status}; no-op.`,
      );
      return;
    }

    const handler = this.handlers.get(delivery.channel);
    if (!handler) {
      // No code shipped for this channel yet (SMS/WhatsApp v1).
      await this.prisma.notificationDelivery.update({
        where: { id: delivery.id },
        data: {
          status: 'SKIPPED',
          errorMessage: `No handler registered for ${delivery.channel}.`,
        },
      });
      return;
    }

    const template = getTemplate(delivery.notification.templateKey);
    if (!template) {
      throw new JobNonRetryableError(
        `Template "${delivery.notification.templateKey}" not in registry`,
      );
    }

    const renderedEmail = template.renderEmail
      ? template.renderEmail(delivery.notification.payload as never)
      : null;
    const renderedInApp = template.renderInApp
      ? template.renderInApp(delivery.notification.payload as never)
      : null;

    await this.prisma.notificationDelivery.update({
      where: { id: delivery.id },
      data: { status: 'SENDING', attempts: { increment: 1 } },
    });

    const result = await handler.send({
      recipient: delivery.recipient,
      rendered:
        delivery.channel === 'EMAIL'
          ? {
              subject: renderedEmail?.subject,
              html: renderedEmail?.html,
              text: renderedEmail?.text,
            }
          : delivery.channel === 'IN_APP'
            ? { title: renderedInApp?.title, body: renderedInApp?.body }
            : {},
      payload: delivery.notification.payload,
      notificationId: delivery.notification.id,
    });

    await this.prisma.notificationDelivery.update({
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

    if (result.status === 'FAILED') {
      // Throw so the queue retries with backoff. The delivery row
      // already records the failure; the throw is purely the queue's
      // signal to schedule the next attempt.
      throw new Error(result.errorMessage ?? 'Delivery FAILED');
    }
  }
}
