import {
  NotificationChannel as ChannelEnum,
  NotificationDeliveryStatus,
} from '@prisma/client';
import { NotificationService } from './notification.service';
import type { PrismaService } from '../database/prisma.service';
import type { EmailChannel } from './channels/email.channel';
import type { InAppChannel } from './channels/in-app.channel';

// ---------------------------------------------------------------------------
// NotificationService — Phase 4 maturity tests.
//
// Covers the orchestrator's contract:
//   • Templates are looked up by key — unknown keys throw (programmer
//     error, NOT a delivery failure).
//   • Idempotency by (templateKey, dedupeKey) — re-enqueueing returns
//     the existing rows without sending again.
//   • Channels are picked from `recipients` ∩ `template.defaultChannels`.
//   • Each channel handler is called with the right rendered body.
//   • Delivery rows transition QUEUED → SENDING → SENT/FAILED/SKIPPED
//     based on the handler's result.
//   • Channels with NO handler (SMS / WhatsApp v1) get SKIPPED, not
//     thrown.
//
// Templates are mocked at module level so the real template registry
// stays out of the test path — keeps the assertions about behaviour,
// not template copy.
// ---------------------------------------------------------------------------

// Override the real template registry with a fixed test set BEFORE
// the service instantiates.
jest.mock('./templates/template-registry', () => {
  const actual = jest.requireActual('./templates/template-registry');
  const TEMPLATES: Record<string, any> = {
    'test.email_only': {
      key: 'test.email_only',
      defaultChannels: ['EMAIL'],
      renderEmail: (_: unknown) => ({
        subject: 'Subj',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
    },
    'test.email_and_inapp': {
      key: 'test.email_and_inapp',
      defaultChannels: ['EMAIL', 'IN_APP'],
      renderEmail: (_: unknown) => ({
        subject: 'Subj',
        html: '<p>Hi</p>',
        text: 'Hi',
      }),
      renderInApp: (_: unknown) => ({ title: 'In-app title', body: 'Body' }),
    },
    'test.inapp_only': {
      key: 'test.inapp_only',
      defaultChannels: ['IN_APP'],
      renderInApp: (_: unknown) => ({ title: 'In-app', body: 'Hi' }),
    },
    'test.sms_targeted': {
      key: 'test.sms_targeted',
      // SMS isn't wired in v1 — handler will be missing.
      defaultChannels: ['SMS'],
    },
  };
  return {
    ...actual,
    TEMPLATES,
    getTemplate: (key: string) => TEMPLATES[key],
  };
});

interface DeliveryRow {
  id: string;
  notificationId: string;
  channel: ChannelEnum;
  recipient: string;
  status: NotificationDeliveryStatus;
  attempts: number;
  errorMessage: string | null;
  providerMessageId: string | null;
  sentAt: Date | null;
}

interface NotificationRow {
  id: string;
  templateKey: string;
  schoolId: string | null;
  userId: string | null;
  payload: Record<string, unknown>;
  dedupeKey: string | null;
  createdAt: Date;
}

function buildHarness() {
  const notifications: NotificationRow[] = [];
  const deliveries: DeliveryRow[] = [];
  let idCounter = 0;
  const nextId = () => `id-${++idCounter}`;

  const prisma: Partial<PrismaService> = {
    notification: {
      findUnique: jest.fn(async ({ where, include }: any) => {
        const composite = where.templateKey_dedupeKey;
        if (!composite) return null;
        const found = notifications.find(
          (n) =>
            n.templateKey === composite.templateKey &&
            n.dedupeKey === composite.dedupeKey,
        );
        if (!found) return null;
        if (include?.deliveries) {
          return {
            ...found,
            deliveries: deliveries.filter((d) => d.notificationId === found.id),
          };
        }
        return found;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: NotificationRow = {
          id: nextId(),
          templateKey: data.templateKey,
          schoolId: data.schoolId ?? null,
          userId: data.userId ?? null,
          payload: data.payload ?? {},
          dedupeKey: data.dedupeKey ?? null,
          createdAt: new Date(),
        };
        notifications.push(row);
        return row;
      }),
    } as any,
    notificationDelivery: {
      create: jest.fn(async ({ data }: any) => {
        const row: DeliveryRow = {
          id: nextId(),
          notificationId: data.notificationId,
          channel: data.channel,
          recipient: data.recipient,
          status: data.status ?? 'QUEUED',
          attempts: 0,
          errorMessage: null,
          providerMessageId: null,
          sentAt: null,
        };
        deliveries.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const idx = deliveries.findIndex((d) => d.id === where.id);
        if (idx < 0) throw new Error('not found');
        const cur = deliveries[idx];
        const next: DeliveryRow = {
          ...cur,
          ...('status' in data ? { status: data.status } : {}),
          ...('attempts' in data
            ? {
                attempts:
                  typeof data.attempts === 'object' && 'increment' in data.attempts
                    ? cur.attempts + data.attempts.increment
                    : data.attempts,
              }
            : {}),
          ...('errorMessage' in data
            ? { errorMessage: data.errorMessage }
            : {}),
          ...('providerMessageId' in data
            ? { providerMessageId: data.providerMessageId }
            : {}),
          ...('sentAt' in data ? { sentAt: data.sentAt } : {}),
        };
        deliveries[idx] = next;
        return next;
      }),
    } as any,
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const emailHandler: jest.Mocked<EmailChannel> = {
    channel: 'EMAIL',
    send: jest.fn(async () => ({
      status: 'SENT' as NotificationDeliveryStatus,
      providerMessageId: 'mock-msg-id',
    })),
  } as any;

  const inAppHandler: jest.Mocked<InAppChannel> = {
    channel: 'IN_APP',
    send: jest.fn(async () => ({ status: 'SENT' as NotificationDeliveryStatus })),
  } as any;

  const service = new NotificationService(
    prisma as PrismaService,
    emailHandler,
    inAppHandler,
  );

  return { service, notifications, deliveries, emailHandler, inAppHandler };
}

describe('NotificationService.enqueue', () => {
  describe('template lookup', () => {
    it('throws (programmer error) for an unknown templateKey', async () => {
      const h = buildHarness();
      await expect(
        h.service.enqueue({
          templateKey: 'totally.unknown',
          recipients: { email: 'a@b' },
          payload: {},
        }),
      ).rejects.toThrow(/Unknown notification template/);
      expect(h.notifications).toHaveLength(0);
    });
  });

  describe('idempotency', () => {
    it('reuses an existing notification when (templateKey, dedupeKey) matches', async () => {
      const h = buildHarness();
      const first = await h.service.enqueue({
        templateKey: 'test.email_only',
        recipients: { email: 'a@b' },
        payload: { v: 1 },
        dedupeKey: 'k1',
      });
      const second = await h.service.enqueue({
        templateKey: 'test.email_only',
        recipients: { email: 'a@b' },
        payload: { v: 2 }, // would-be different payload — ignored
        dedupeKey: 'k1',
      });

      expect(first.deduped).toBe(false);
      expect(second.deduped).toBe(true);
      expect(second.notification.id).toBe(first.notification.id);
      // Handler called exactly once across both enqueues.
      expect(h.emailHandler.send).toHaveBeenCalledTimes(1);
    });

    it('without dedupeKey, two enqueues create two separate notifications', async () => {
      const h = buildHarness();
      await h.service.enqueue({
        templateKey: 'test.email_only',
        recipients: { email: 'a@b' },
        payload: {},
      });
      await h.service.enqueue({
        templateKey: 'test.email_only',
        recipients: { email: 'a@b' },
        payload: {},
      });
      expect(h.notifications).toHaveLength(2);
      expect(h.emailHandler.send).toHaveBeenCalledTimes(2);
    });
  });

  describe('channel fan-out', () => {
    it('uses template.defaultChannels when none specified', async () => {
      const h = buildHarness();
      await h.service.enqueue({
        templateKey: 'test.email_and_inapp',
        recipients: { email: 'a@b', inApp: 'user-1' },
        payload: {},
      });
      expect(h.emailHandler.send).toHaveBeenCalledTimes(1);
      expect(h.inAppHandler.send).toHaveBeenCalledTimes(1);
    });

    it('skips channels for which no recipient was provided', async () => {
      const h = buildHarness();
      // Template defaults to [EMAIL, IN_APP]; we only give an email.
      await h.service.enqueue({
        templateKey: 'test.email_and_inapp',
        recipients: { email: 'a@b' },
        payload: {},
      });
      expect(h.emailHandler.send).toHaveBeenCalledTimes(1);
      expect(h.inAppHandler.send).not.toHaveBeenCalled();
      // Only one delivery row was created.
      expect(h.deliveries).toHaveLength(1);
      expect(h.deliveries[0].channel).toBe('EMAIL');
    });

    it('honors an explicit `channels` override (subset of recipients)', async () => {
      const h = buildHarness();
      await h.service.enqueue({
        templateKey: 'test.email_and_inapp',
        recipients: { email: 'a@b', inApp: 'user-1' },
        channels: ['IN_APP'], // skip email even though template wants both
        payload: {},
      });
      expect(h.emailHandler.send).not.toHaveBeenCalled();
      expect(h.inAppHandler.send).toHaveBeenCalledTimes(1);
    });
  });

  describe('rendering', () => {
    it('passes the rendered email body to the EmailChannel handler', async () => {
      const h = buildHarness();
      await h.service.enqueue({
        templateKey: 'test.email_only',
        recipients: { email: 'a@b' },
        payload: { foo: 'bar' },
      });
      expect(h.emailHandler.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: 'a@b',
          rendered: expect.objectContaining({
            subject: 'Subj',
            html: '<p>Hi</p>',
            text: 'Hi',
          }),
        }),
      );
    });

    it('passes the rendered in-app body to the InAppChannel handler', async () => {
      const h = buildHarness();
      await h.service.enqueue({
        templateKey: 'test.inapp_only',
        recipients: { inApp: 'user-1' },
        payload: {},
      });
      expect(h.inAppHandler.send).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: 'user-1',
          rendered: expect.objectContaining({
            title: 'In-app',
            body: 'Hi',
          }),
        }),
      );
    });
  });

  describe('delivery state machine', () => {
    it('marks SENT when the handler resolves with SENT', async () => {
      const h = buildHarness();
      const result = await h.service.enqueue({
        templateKey: 'test.email_only',
        recipients: { email: 'a@b' },
        payload: {},
      });
      expect(result.deliveries).toHaveLength(1);
      expect(result.deliveries[0].status).toBe('SENT');
      expect(result.deliveries[0].attempts).toBe(1);
      expect(result.deliveries[0].providerMessageId).toBe('mock-msg-id');
      expect(result.deliveries[0].sentAt).toBeInstanceOf(Date);
    });

    it('marks FAILED + records errorMessage when the handler resolves with FAILED', async () => {
      const h = buildHarness();
      h.emailHandler.send.mockResolvedValueOnce({
        status: 'FAILED' as NotificationDeliveryStatus,
        errorMessage: 'SMTP 550 mailbox unavailable',
      });
      const result = await h.service.enqueue({
        templateKey: 'test.email_only',
        recipients: { email: 'a@b' },
        payload: {},
      });
      expect(result.deliveries[0].status).toBe('FAILED');
      expect(result.deliveries[0].errorMessage).toContain('SMTP 550');
      expect(result.deliveries[0].sentAt).toBeNull();
    });

    it('marks SKIPPED when no handler is registered for the channel', async () => {
      const h = buildHarness();
      // SMS template — no handler in the registry.
      const result = await h.service.enqueue({
        templateKey: 'test.sms_targeted',
        recipients: { sms: '+15551234' },
        payload: {},
      });
      expect(result.deliveries).toHaveLength(1);
      expect(result.deliveries[0].status).toBe('SKIPPED');
      expect(result.deliveries[0].errorMessage).toContain('No handler');
      expect(h.emailHandler.send).not.toHaveBeenCalled();
    });

    it('bumps attempts to 1 on first dispatch (no retries in v1)', async () => {
      const h = buildHarness();
      const result = await h.service.enqueue({
        templateKey: 'test.email_only',
        recipients: { email: 'a@b' },
        payload: {},
      });
      expect(result.deliveries[0].attempts).toBe(1);
    });
  });
});
