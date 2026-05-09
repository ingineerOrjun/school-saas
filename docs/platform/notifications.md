# Notification Flow

How transactional notifications are produced, persisted, dispatched,
and presented to operators.

## Layers

```
Producer (your service)
  → NotificationService.enqueue({ templateKey, recipients, payload, ... })
      → Notification row created (idempotency: (templateKey, dedupeKey))
      → NotificationDelivery rows created (one per channel)
      → Synchronous dispatch:
          → ChannelHandler.send(rendered, recipient)
            → EmailChannel → EmailProvider (Console / SMTP)
            → InAppChannel → no-op (rows ARE the inbox until UI ships)
          → Delivery.status updated to SENT / FAILED / SKIPPED
      → Notification rendered + stored (severity + title for the inbox)
```

The synchronous path is what existing producers (security, fees,
auth, subscriptions) use. The async path uses the job queue:

```
Producer → JobQueueService.enqueue({ name: "notification.send_delivery",
                                     payload: { deliveryId } })
JobRunner picks up → SendDeliveryHandler.run() → same dispatch as above,
                     but with retry + backoff on failure
```

Currently **one** producer uses the async path: the daily
subscription-expiring cron, which enqueues N
`platform.subscription_expiring_notice` jobs (one per due school)
that the runner drains async with retry.

## Adding a new template

1. Create `backend/src/notifications/templates/<your>.template.ts`:

   ```ts
   export interface MyPayload { brand: BrandConfig; ... }
   export const myTemplate: NotificationTemplate<MyPayload> = {
     key: 'platform.my_event',
     defaultChannels: ['EMAIL'],
     renderEmail: (p) => ({ subject, html: wrapEmail(...), text }),
   };
   ```

2. Register it in `template-registry.ts`:

   ```ts
   import { myTemplate } from './my.template';
   export const TEMPLATES = {
     ...,
     [myTemplate.key]: myTemplate,
   };
   ```

3. Call from your producer:

   ```ts
   await this.notifications.enqueue({
     templateKey: myTemplate.key,
     recipients: { email: user.email },
     dedupeKey: `event:${eventId}`,   // optional
     severity: 'WARNING',              // optional, defaults to INFO
     title: 'Custom title for inbox',  // optional
     payload: { brand: this.config.get('mail.brand'), ... },
   });
   ```

That's the whole contract. No DTOs, no separate registry update,
no migration.

## Idempotency

Every `enqueue` call accepts an optional `dedupeKey`. Combined with
`templateKey`, it forms the unique constraint on the `notifications`
table. Re-calling with the same pair returns the existing
notification + deliveries, NOT a duplicate.

Producers should pick a dedupe key tied to the EVENT, not the
attempt:

- `user:<id>:welcome` — fires once, ever, per user.
- `payment:<id>:receipt` — fires once per payment.
- `school:<id>:expiring:14:20260530` — fires at most once per
  (school, threshold, day) per scan run.

## Channels

| Channel | Today | Future |
|---|---|---|
| EMAIL | Console (dev) or SMTP (prod) via `EmailProvider` | SES, SendGrid, Mailgun |
| IN_APP | Rows in DB, no UI yet | School-side bell + inbox |
| SMS | Skipped (no handler) | Twilio / Nikatel |
| WHATSAPP | Skipped (no handler) | Twilio Business |

Adding a new channel:

1. New value in `NotificationChannel` enum + migration.
2. New handler implementing `NotificationChannelHandler`.
3. Register the handler in `NotificationService` constructor.
4. Update the channel selection in `enqueue()`.

## Notification Center

`/platform/notifications` is the operator-facing inbox. Backed by
`NotificationCenterService`:

- `GET /platform/notifications` — paginated, filterable list.
- `GET /platform/notifications/:id` — full row + per-channel deliveries.
- `GET /platform/notifications/unread-count` — bell badge.
- `PATCH /platform/notifications/:id/read` / `/unread` — toggle.

Filters: `severity` (comma-separated), `unread` (`true`),
`schoolId`. Pagination: `page`, `pageSize` (capped at 100).

## What's NOT here yet

- Per-recipient retry of FAILED deliveries from the operator UI.
  Currently the operator sees the failure; re-firing requires the
  producer to call `enqueue` again.
- A scheduled cleanup of old notification rows. The table will grow
  indefinitely; a future archival job should move rows older than
  N months to cold storage.
- School-side in-app inbox. The `IN_APP` channel rows exist in the
  DB; the UI to render them at `/inbox` is a future iteration.
