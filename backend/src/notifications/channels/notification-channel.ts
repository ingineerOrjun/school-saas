import type {
  NotificationChannel as Channel,
  NotificationDeliveryStatus,
} from '@prisma/client';

// ---------------------------------------------------------------------------
// NotificationChannelHandler — common contract every channel implements.
//
// One handler per Channel enum value. The NotificationService picks
// the right handler based on the delivery row's `channel` column and
// asks it to `send()`. The handler returns the new status (and
// optional provider id / error message) — the service writes the
// delivery row.
//
// The contract is deliberately narrow: handlers don't touch the DB,
// don't do retries, don't audit. They just translate the
// Notification + Delivery into a side-effect (an HTTP call, a DB
// write to an in_app table, etc.) and report what happened.
// ---------------------------------------------------------------------------

export interface NotificationDispatchInput {
  /** The recipient as stored in the delivery row. */
  recipient: string;
  /** Resolved template + payload — the handler doesn't re-render. */
  rendered: {
    subject?: string;
    html?: string;
    text?: string;
    title?: string;
    body?: string;
  };
  /** Original payload, in case the handler needs custom fields. */
  payload: unknown;
  /** Notification id — useful for provider-side tagging. */
  notificationId: string;
}

export interface NotificationDispatchResult {
  status: NotificationDeliveryStatus;
  providerMessageId?: string;
  errorMessage?: string;
}

export interface NotificationChannelHandler {
  channel: Channel;
  send(input: NotificationDispatchInput): Promise<NotificationDispatchResult>;
}
