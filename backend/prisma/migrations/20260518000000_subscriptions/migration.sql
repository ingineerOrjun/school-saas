-- ---------------------------------------------------------------------------
-- Phase 4 — Subscriptions.
--
-- Append-only subscription history per school. Each row represents
-- one subscription period; the "current" subscription is the
-- most-recent row (by createdAt) where endDate >= now() OR endDate
-- IS NULL (the unlimited case). New plans / renewals / extensions
-- all create a new row — never edit. That keeps the audit story
-- clean: every change is its own SUBSCRIPTION_CREATED platform
-- audit event.
--
-- `enabledFeatures` is a JSON map (e.g. `{"sms": true, "transport": false}`).
-- Phase 5 will wire enforcement; today the column is captured but
-- not consulted by request gates.
--
-- Limits (`studentLimit`, `teacherLimit`) are nullable for "unlimited"
-- plans. Phase 5 will enforce on writes; today the platform UI
-- shows them as "X of Y students" indicators.
--
-- Plus three new audit actions covering the subscription lifecycle.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionPlan') THEN
    CREATE TYPE "SubscriptionPlan" AS ENUM ('TRIAL', 'MONTHLY', 'YEARLY', 'UNLIMITED');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BillingCycle') THEN
    CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY', 'ONE_TIME', 'PERPETUAL');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "school_subscriptions" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "schoolId"        UUID NOT NULL,
  "plan"            "SubscriptionPlan" NOT NULL,
  "billingCycle"    "BillingCycle" NOT NULL,
  "startDate"       TIMESTAMP NOT NULL,
  "endDate"         TIMESTAMP,
  "studentLimit"    INTEGER,
  "teacherLimit"    INTEGER,
  "enabledFeatures" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "notes"           TEXT,
  "createdById"     UUID,
  "createdAt"       TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt"       TIMESTAMP NOT NULL DEFAULT now(),

  CONSTRAINT "school_subscriptions_school_fkey"
    FOREIGN KEY ("schoolId") REFERENCES "schools"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "school_subscriptions_creator_fkey"
    FOREIGN KEY ("createdById") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- DESC index on (schoolId, createdAt) so "find the current
-- subscription" is one index seek per school.
CREATE INDEX IF NOT EXISTS "school_subscriptions_school_recent_idx"
  ON "school_subscriptions" ("schoolId", "createdAt" DESC);

-- New audit actions covering subscription lifecycle.
ALTER TYPE "PlatformAuditAction" ADD VALUE IF NOT EXISTS 'SUBSCRIPTION_CREATED';
