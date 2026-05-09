-- ---------------------------------------------------------------------------
-- Phase 2 (maturity) — Notifications.
--
-- Centralized delivery infrastructure. One Notification row per logical
-- event ("password reset for alice@example.edu"); one
-- NotificationDelivery row per channel attempted ("email to
-- alice@example.edu", later possibly "sms to +977..."). Splitting them
-- this way means:
--
--   • A retry on a failed email creates a new Delivery row, never a
--     duplicate Notification — the audit trail stays narrow and the
--     idempotency key (per-Notification) keeps the world sane if a
--     producer fires the same trigger twice.
--   • Adding a new channel later (SMS, WhatsApp, push) is one new
--     `Channel` enum value + one Delivery row writer. Notifications
--     are channel-agnostic at write time.
--
-- Templates intentionally stay in CODE (not in this DB) for v1. A
-- DB-backed template editor adds operational complexity (versioning,
-- preview, migration) that's only worth it once non-engineers need
-- to edit copy. Templates ship as TypeScript modules; the
-- `templateKey` column records WHICH template was used so audit +
-- analytics can group by it.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationChannel') THEN
    CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'IN_APP', 'WHATSAPP');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'NotificationDeliveryStatus') THEN
    CREATE TYPE "NotificationDeliveryStatus" AS ENUM (
      'QUEUED',
      'SENDING',
      'SENT',
      'FAILED',
      'SKIPPED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "notifications" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable code-side template key (e.g. "platform.password_reset",
  -- "school.fee_receipt"). The renderer looks up the template by
  -- this key at delivery time.
  "templateKey"   TEXT NOT NULL,
  -- Optional school scope. NULL for platform-tier notifications
  -- (those addressed to SUPER_ADMINs or to multiple tenants).
  "schoolId"      UUID,
  -- Optional user scope. NULL for broadcasts.
  "userId"        UUID,
  -- Free-form context the renderer reads (e.g. {temporaryPassword,
  -- studentName, amount}). NEVER stores secrets that shouldn't end
  -- up in the DB at rest — see callers for the policy on each
  -- template.
  "payload"       JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Caller-supplied idempotency key. Two `enqueue()` calls with the
  -- same `(templateKey, dedupeKey)` resolve to the same Notification
  -- row — keeps a producer that fires twice from spamming the user.
  -- NULL means "no dedupe; always create".
  "dedupeKey"     TEXT,
  "createdAt"     TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT "notifications_school_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "schools"("id") ON DELETE CASCADE,
  CONSTRAINT "notifications_user_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

-- Idempotency. Postgres treats NULL as distinct, so this only
-- enforces uniqueness when both columns are present — matches the
-- "NULL = no dedupe" semantics.
CREATE UNIQUE INDEX IF NOT EXISTS "notifications_template_dedupe_uniq"
  ON "notifications" ("templateKey", "dedupeKey");

CREATE INDEX IF NOT EXISTS "notifications_school_created_idx"
  ON "notifications" ("schoolId", "createdAt" DESC);
CREATE INDEX IF NOT EXISTS "notifications_user_created_idx"
  ON "notifications" ("userId", "createdAt" DESC);

CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "notificationId" UUID NOT NULL,
  "channel"        "NotificationChannel" NOT NULL,
  -- Per-channel address: email address for EMAIL, phone for SMS,
  -- user id for IN_APP. Stored explicitly so the audit row is
  -- self-contained even if the user record is later edited.
  "recipient"      TEXT NOT NULL,
  "status"         "NotificationDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
  -- Number of send attempts (1-indexed; bumped each retry).
  "attempts"       INTEGER NOT NULL DEFAULT 0,
  -- Last error message on FAILED (truncated to 1KB at the service
  -- layer).
  "errorMessage"   TEXT,
  -- Provider's message id when available — useful for tracing
  -- bounces back to the originating delivery row.
  "providerMessageId" TEXT,
  "sentAt"         TIMESTAMP,
  "createdAt"      TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT "notification_deliveries_notification_fkey"
    FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "notification_deliveries_notification_idx"
  ON "notification_deliveries" ("notificationId");
CREATE INDEX IF NOT EXISTS "notification_deliveries_status_idx"
  ON "notification_deliveries" ("status");
